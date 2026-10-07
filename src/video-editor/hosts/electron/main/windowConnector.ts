import type { IpcMainEvent } from "electron";
import {
	createElectronMainPortTransport,
	type ElectronMainPortLike,
	type ElectronMainPortTransport,
} from "../../../adapters/transport/electron/createElectronMainPortTransport";
import type { NodeMiniCutHost } from "../../../adapters/node/startNodeMiniCutHost";
import { DKT_MSG } from "../../../dkt/shared/messageTypes";
import {
	ELECTRON_IPC,
	type DesktopHandshakeReply,
} from "../shared/ipcChannels";

export type MessageChannelLike = {
	port1: ElectronMainPortLike;
	port2: unknown;
};

/** The part of `WebContents` the window sessions use. */
export type WindowWebContentsLike = {
	readonly id: number;
	readonly mainFrame: unknown;
	postMessage(channel: string, message: unknown, transfer?: never[]): void;
	on(event: string, listener: (...args: never[]) => void): unknown;
	off(event: string, listener: (...args: never[]) => void): unknown;
};

export type WindowConnectorOptions = {
	runtime: Pick<NodeMiniCutHost["runtime"], "connect">;
	/** Room key of the local workspace; every window uses the same one. */
	sessionKey: string;
	createMessageChannel(): MessageChannelLike;
	ipcMain: {
		on(channel: string, listener: (event: IpcMainEvent) => void): unknown;
		removeListener(
			channel: string,
			listener: (event: IpcMainEvent) => void,
		): unknown;
	};
	/** Only pages that return true may open a DKT channel. */
	isTrustedRendererUrl(url: string): boolean;
};

export type ConnectedWindow = {
	sessionId: string;
	webContentsId: number;
	/** The channel of the window's current document; null between documents. */
	transport: ElectronMainPortTransport;
	/**
	 * `_node_id` of the window's session root, taken from the RUNTIME_READY the
	 * runtime sent it; null until the window has bootstrapped.
	 */
	rootNodeId: string | null;
};

/**
 * True when `url` is the prefix itself or lies below it. A prefix without a
 * trailing slash matches only at a path, query or hash boundary, so
 * `http://localhost:5173` never matches `http://localhost:5173.evil.com`.
 */
export const isUrlUnderPrefix = (url: string, prefix: string): boolean => {
	if (url === prefix) return true;
	if (prefix.endsWith("/")) return url.startsWith(prefix);
	return (
		url.startsWith(prefix) && ["/", "?", "#"].includes(url.charAt(prefix.length))
	);
};

/** Window session id: stable for a webContents, never reused within a run. */
export const createWindowSessionId = (
	sessionKey: string,
	webContentsId: number,
): string => `${sessionKey}:window:${webContentsId}`;

type WindowEntry = {
	sessionId: string;
	webContentsId: number;
	/** Connection order; the oldest live window is the first in the list. */
	order: number;
	live: {
		transport: ElectronMainPortTransport;
		rootNodeId: string | null;
		destroy(): void;
	} | null;
	stopObserving: () => void;
};

const postHandshake = (
	sender: WindowWebContentsLike,
	message: DesktopHandshakeReply,
	ports: unknown[],
): void => {
	sender.postMessage(ELECTRON_IPC.PORT, message, ports as never[]);
};

/**
 * Maps each window (webContents) to one session and one DKT connection.
 *
 * - The session id depends only on the webContents, so a renderer reload
 *   keeps its mapping while the previous connection is replaced: there is
 *   never a second runtime or a second stream for the same document.
 * - The connection is destroyed (stream and listeners removed) when the
 *   window is destroyed, its renderer process is gone, its main frame
 *   navigates away, or its port closes.
 */
export const createWindowConnector = ({
	runtime,
	sessionKey,
	createMessageChannel,
	ipcMain,
	isTrustedRendererUrl,
}: WindowConnectorOptions) => {
	const entries = new Map<number, WindowEntry>();
	let connectSequence = 0;
	const changeListeners = new Set<() => void>();
	/**
	 * Import batches by runtime handle id, recorded from the window's own
	 * requestImportFiles dispatch. Handle ids are per-window counters, so one
	 * id can be pending in several windows: a FIFO of owners per id.
	 */
	const pendingImports = new Map<string, WindowEntry[]>();
	const forgetImports = (entry: WindowEntry): void => {
		for (const [handleId, owners] of [...pendingImports]) {
			const rest = owners.filter((owner) => owner !== entry);
			if (rest.length === 0) pendingImports.delete(handleId);
			else pendingImports.set(handleId, rest);
		}
	};
	const notifyChanged = (): void => {
		for (const listener of [...changeListeners]) {
			listener();
		}
	};

	const detach = (entry: WindowEntry): void => {
		const live = entry.live;
		entry.live = null;
		forgetImports(entry);
		if (live) {
			live.destroy();
			notifyChanged();
		}
	};

	const forget = (entry: WindowEntry): void => {
		detach(entry);
		entry.stopObserving();
		entries.delete(entry.webContentsId);
	};

	const observe = (
		sender: WindowWebContentsLike,
		entry: WindowEntry,
	): (() => void) => {
		const onDestroyed = () => forget(entry);
		const onProcessGone = () => detach(entry);
		const onNavigation = (details: {
			isMainFrame?: boolean;
			isSameDocument?: boolean;
		}) => {
			if (details.isMainFrame && !details.isSameDocument) {
				detach(entry);
			}
		};
		sender.on("destroyed", onDestroyed as never);
		sender.on("render-process-gone", onProcessGone as never);
		sender.on("did-start-navigation", onNavigation as never);
		return () => {
			sender.off("destroyed", onDestroyed as never);
			sender.off("render-process-gone", onProcessGone as never);
			sender.off("did-start-navigation", onNavigation as never);
		};
	};

	const onConnect = (event: IpcMainEvent): void => {
		const sender = event.sender as unknown as WindowWebContentsLike;
		const frame = event.senderFrame;
		if (
			!frame ||
			frame !== sender.mainFrame ||
			!isTrustedRendererUrl(frame.url)
		) {
			return;
		}

		let entry = entries.get(sender.id);
		if (entry) {
			// Reload or a repeated request: the previous document is gone.
			detach(entry);
		} else {
			const created: WindowEntry = {
				sessionId: createWindowSessionId(sessionKey, sender.id),
				webContentsId: sender.id,
				order: 0,
				live: null,
				stopObserving: () => undefined,
			};
			created.stopObserving = observe(sender, created);
			entries.set(sender.id, created);
			entry = created;
		}

		const { port1, port2 } = createMessageChannel();
		const transport = createElectronMainPortTransport(port1);
		const owner = entry;
		// What the window dispatches is the only record of which window owns an import batch.
		transport.listen((message) => {
			if (
				message.type !== DKT_MSG.DISPATCH_ACTION ||
				message.actionName !== "requestImportFiles"
			) {
				return;
			}
			const handleId = (message.payload as { inputBatchHandleId?: unknown } | null)
				?.inputBatchHandleId;
			if (typeof handleId === "string" && handleId) {
				pendingImports.set(handleId, [...(pendingImports.get(handleId) ?? []), owner]);
			}
		});
		try {
			// The root node id travels in the RUNTIME_READY sent to this window.
			const observed: typeof transport = {
				send(message, transferList) {
					if (message.type === DKT_MSG.RUNTIME_READY && owner.live) {
						owner.live.rootNodeId = message.rootNodeId ?? null;
					}
					transport.send(message, transferList);
				},
				listen: (listener) => transport.listen(listener),
				destroy: () => transport.destroy(),
				onDisconnect: (listener) => transport.onDisconnect(listener),
			};
			const connection = runtime.connect(observed);
			entry.order = connectSequence += 1;
			const live = {
				transport,
				rootNodeId: null as string | null,
				destroy: () => connection.destroy(),
			};
			entry.live = live;
			notifyChanged();
			transport.onDisconnect(() => {
				if (entry.live === live) {
					detach(entry);
				}
			});
		} catch (error) {
			transport.destroy();
			postHandshake(
				sender,
				{ error: error instanceof Error ? error.message : String(error) },
				[],
			);
			return;
		}
		postHandshake(
			sender,
			{ sessionKey, sessionId: entry.sessionId },
			[port2],
		);
	};

	ipcMain.on(ELECTRON_IPC.CONNECT, onConnect);
	return {
		/** Windows with a live connection, oldest connection first. */
		getConnectedWindows(): ConnectedWindow[] {
			return [...entries.values()]
				.filter((entry) => entry.live)
				.sort((a, b) => a.order - b.order)
				.map((entry) => ({
					sessionId: entry.sessionId,
					webContentsId: entry.webContentsId,
					transport: (entry.live as NonNullable<WindowEntry["live"]>).transport,
					rootNodeId: (entry.live as NonNullable<WindowEntry["live"]>).rootNodeId,
				}));
		},
		/**
		 * The window that staged the import batch, consuming one pending record.
		 * Null when no live window dispatched a batch with this handle id.
		 */
		claimImportWindow(handleId: string): ConnectedWindow | null {
			const owners = pendingImports.get(handleId) ?? [];
			while (owners.length > 0) {
				const entry = owners.shift() as WindowEntry;
				if (owners.length === 0) pendingImports.delete(handleId);
				if (entry.live) {
					return {
						sessionId: entry.sessionId,
						webContentsId: entry.webContentsId,
						transport: entry.live.transport,
						rootNodeId: entry.live.rootNodeId,
					};
				}
			}
			pendingImports.delete(handleId);
			return null;
		},
		/** Called after a window connects or its connection is detached. */
		onConnectedWindowsChanged(listener: () => void): () => void {
			changeListeners.add(listener);
			return () => {
				changeListeners.delete(listener);
			};
		},
		dispose(): void {
			ipcMain.removeListener(ELECTRON_IPC.CONNECT, onConnect);
			for (const entry of [...entries.values()]) {
				forget(entry);
			}
		},
	};
};
