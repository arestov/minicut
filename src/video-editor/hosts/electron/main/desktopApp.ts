import type { IpcMain, MessageChannelMain, Protocol } from "electron";
import {
	createNodeAssetRegistry,
	nodeAssetRegistryPathFor,
	type NodeAssetRegistry,
} from "../../../adapters/node/nodeAssetRegistry";
import {
	startNodeMiniCutHost,
	type NodeMiniCutHost,
} from "../../../adapters/node/startNodeMiniCutHost";
import type { DesktopMediaService } from "../../../media/node/rpc/mediaServiceClient";
import { createAssetUrl, MINICUT_APP_URL_PREFIX } from "../shared/ipcChannels";
import { createDesktopEffectInterfaces } from "./createDesktopEffectInterfaces";
import { createDesktopExecutors, type DesktopExecutors } from "./desktopExecutors";
import { registerImportIpc } from "./importIpc";
import {
	startMediaServiceProcess,
	type MediaServiceProcess,
	type UtilityProcessApi,
} from "./mediaServiceProcess";
import {
	createMiniCutProtocolHandler,
	createRegistryAssetSource,
} from "./protocolHandler";
import { installMiniCutProtocol } from "./registerProtocol";
import {
	createWindowConnector,
	isUrlUnderPrefix,
	type MessageChannelLike,
} from "./windowConnector";

export type DesktopElectronApi = {
	ipcMain: Pick<IpcMain, "on" | "removeListener">;
	protocol: Pick<Protocol, "handle">;
	/** `MessageChannelMain` constructor. */
	MessageChannelMain: typeof MessageChannelMain;
	/** `utilityProcess`: the media service runs there, not in a renderer. */
	utilityProcess: UtilityProcessApi;
};

export type StartDesktopAppOptions = {
	/** The shared desktop profile (`resolveProfileDir`); GPUIX uses the same one, in turn. */
	profileDir: string;
	/** Built renderer served under `minicut://local/app/`. */
	rendererDir: string;
	/** Built media service entry (`dist-electron/utility/mediaService.mjs`). */
	mediaServiceEntryPath: string;
	/** Directory exports are written to. */
	exportDirectory: string;
	electron: DesktopElectronApi;
	/** Extra URL prefixes allowed to open channels (a dev server). */
	trustedRendererUrlPrefixes?: readonly string[];
	generateUuid?: () => string;
	/** Environment of the media service process (ffmpeg paths); defaults to this process. */
	mediaServiceEnv?: NodeJS.ProcessEnv;
	/** Observes every message the runtime sends to a renderer window (tests). */
	observeWindowMessages?: (window: { sessionId: string }, message: unknown) => void;
	/** An effect had no owner; defaults to a warning. */
	onEffectDropped?: (type: string, reason: string) => void;
};

export type DesktopApp = {
	host: NodeMiniCutHost;
	/** Persistent registry of the workspace (asset id -> local file); the protocol serves from it. */
	assets: NodeAssetRegistry;
	/** The Node media service in the utility process. */
	media: DesktopMediaService;
	windows: ReturnType<typeof createWindowConnector>;
	/** Idempotent: detaches windows, ends the media service and releases the LevelDB lock. */
	dispose(): Promise<void>;
};

/**
 * Electron main composition (configuration B). The shared Node host
 * (identity, LevelDB, local CRDT engine without network transport) lives for
 * the lifetime of the app; windows attach to it through the connector as
 * views, each with its own session root. The media service runs in a utility
 * process; the main process runs the import, export and media recovery
 * executors on it, acting as the owning window's session over that window's
 * own connection (the host adds no session of its own), and serves media to
 * the renderers by asset id from the persistent registry.
 * Startup failures are rethrown and release what was opened; they never
 * produce an empty project.
 */
export const startDesktopApp = async ({
	profileDir,
	rendererDir,
	mediaServiceEntryPath,
	exportDirectory,
	electron,
	trustedRendererUrlPrefixes = [],
	generateUuid = () => crypto.randomUUID(),
	mediaServiceEnv,
	observeWindowMessages,
	onEffectDropped = (type, reason) =>
		console.warn("[minicut:electron] effect dropped", type, reason),
}: StartDesktopAppOptions): Promise<DesktopApp> => {
	// The effect interfaces are needed before the runtime exists, the window
	// connector after it: windows are resolved lazily.
	let windows: ReturnType<typeof createWindowConnector> | null = null;
	let executors: DesktopExecutors | null = null;
	const effectInterfaces = createDesktopEffectInterfaces({
		sink: () => executors,
		getWindows: () =>
			(windows?.getConnectedWindows() ?? []).map((window) => ({
				rootNodeId: window.rootNodeId,
				transport: {
					send(message) {
						observeWindowMessages?.(window, message);
						window.transport.send(message);
					},
				},
			})),
		onDropped: onEffectDropped,
	});
	const host = await startNodeMiniCutHost({
		profileDir,
		effectInterfaces,
		generateUuid,
	});

	const cleanups: Array<() => void | Promise<void>> = [];
	let disposePromise: Promise<void> | null = null;
	const dispose = (): Promise<void> => {
		disposePromise ||= (async () => {
			let firstError: unknown = null;
			for (const cleanup of cleanups.splice(0).reverse()) {
				try {
					await cleanup();
				} catch (error) {
					firstError ??= error;
				}
			}
			if (firstError) throw firstError;
		})();
		return disposePromise;
	};
	// The runtime and its database close last.
	cleanups.push(() => host.dispose());

	try {
		const assets = await createNodeAssetRegistry({
			filePath: nodeAssetRegistryPathFor(host.identity.storagePath),
			generateId: generateUuid,
		});
		cleanups.push(() => assets.flush());

		const mediaProcess: MediaServiceProcess = await startMediaServiceProcess({
			utilityProcess: electron.utilityProcess,
			entryPath: mediaServiceEntryPath,
			assets,
			...(mediaServiceEnv ? { env: mediaServiceEnv } : {}),
			onExit: (code) =>
				console.error("[minicut:electron] media service exited", code),
		});
		cleanups.push(() => mediaProcess.dispose());

		executors = createDesktopExecutors({
			getSessions: () => windows?.getConnectedWindows() ?? [],
			media: mediaProcess.service,
			registry: assets,
			exportDirectory,
			ownerPeerId: host.identity.peerId,
			assetUrl: createAssetUrl,
			generateId: generateUuid,
			now: () => Date.now(),
			onDropped: (fxName, reason) => onEffectDropped(fxName, reason),
			onFailed: (fxName, error) =>
				console.error(`[minicut:electron] ${fxName} executor failed`, error),
		});
		const runningExecutors = executors;
		cleanups.push(() => runningExecutors.dispose());

		const trustedPrefixes = [MINICUT_APP_URL_PREFIX, ...trustedRendererUrlPrefixes];
		const isTrustedRendererUrl = (url: string): boolean =>
			trustedPrefixes.some((prefix) => isUrlUnderPrefix(url, prefix));

		installMiniCutProtocol(
			electron.protocol,
			createMiniCutProtocolHandler({
				assets: createRegistryAssetSource(assets),
				rendererDir,
			}),
		);
		const connector = createWindowConnector({
			runtime: host.runtime,
			sessionKey: host.identity.roomId,
			// MessagePortMain structurally matches the port the transport needs.
			createMessageChannel: () =>
				new electron.MessageChannelMain() as unknown as MessageChannelLike,
			ipcMain: electron.ipcMain as never,
			isTrustedRendererUrl,
		});
		windows = connector;
		cleanups.push(() => connector.dispose());
		const importIpc = registerImportIpc({
			ipcMain: electron.ipcMain as never,
			isTrustedRendererUrl,
			rootNodeIdOf: (webContentsId) =>
				connector
					.getConnectedWindows()
					.find((window) => window.webContentsId === webContentsId)?.rootNodeId ?? null,
			stage: (rootNodeId, paths) => runningExecutors.stageImport(rootNodeId, paths),
		});
		cleanups.push(() => importIpc.dispose());
		// Executors of closed windows are released; their running exports stop.
		cleanups.push(
			connector.onConnectedWindowsChanged(() => {
				const live = new Set<string>();
				for (const window of connector.getConnectedWindows()) {
					if (window.rootNodeId) live.add(window.rootNodeId);
				}
				runningExecutors.retainRoots(live).catch((error: unknown) => {
					console.error("[minicut:electron] releasing window executors failed", error);
				});
			}),
		);

		return { host, assets, media: mediaProcess.service, windows: connector, dispose };
	} catch (error) {
		await dispose().catch(() => undefined);
		throw error;
	}
};
