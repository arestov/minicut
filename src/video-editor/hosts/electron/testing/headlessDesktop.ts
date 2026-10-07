import type { MessagePort } from "node:worker_threads";
import type { PageSyncRuntime } from "../../../../dkt-ui-sync/runtime/PageSyncRuntime";
import { createMiniCutPageSyncRuntime } from "../../../dkt/runtime/createMiniCutPageSyncRuntime";
import { createPortTransport } from "../../../dkt/shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";
import { startDesktopApp, type DesktopApp } from "../main/desktopApp";
import type { PreviewProxyStatus } from "../main/desktopExecutors";
import {
	ELECTRON_IPC,
	MINICUT_APP_URL_PREFIX,
	type DesktopImportStaging,
} from "../shared/ipcChannels";
import { createFakeMessageChannelMain } from "./fakeElectron";
import { createFakeUtilityProcess } from "./fakeUtilityProcess";
import { createFakeIpc, createFakeWindow } from "./fakeWindows";

class FakeMessageChannelMain {
	readonly port1;
	readonly port2;
	constructor() {
		const channel = createFakeMessageChannelMain();
		this.port1 = channel.port1;
		this.port2 = channel.port2;
	}
}

export type HeadlessDesktopWindow = {
	/** The page sync runtime of this window, exactly what a renderer builds. */
	page: PageSyncRuntime;
	/** The window picks local files for import; the batch id goes into `requestImportFiles`. */
	stage(paths: readonly string[]): DesktopImportStaging;
	/** Closes the window the way the renderer going away does. */
	close(): void;
};

export type HeadlessDesktop = {
	app: DesktopApp;
	/** Opens a window: connects it to the host and bootstraps its page runtime. */
	openWindow(webContentsId: number): HeadlessDesktopWindow;
	/** Minicut protocol handler the host installed. */
	serve(url: string): Promise<Response>;
	dispose(): Promise<void>;
};

export type StartHeadlessDesktopOptions = {
	profileDir: string;
	exportDirectory: string;
	/** The scrub proxy of an imported video changed state. */
	onProxyChanged?: (assetId: string, status: PreviewProxyStatus) => void;
	/** Effects that had no owner (fx name, reason). */
	onEffectDropped?: (effect: string, reason: string) => void;
	/** Messages the runtime sent to a window (e.g. to assert none carries a host-only task). */
	observeWindowMessages?: (window: { sessionId: string }, message: unknown) => void;
};

/**
 * The real Electron main composition without Electron: fake ipc, protocol and
 * windows, the real media service (in-process behind the utility protocol),
 * real LevelDB and registry. Windows are real page sync runtimes, so tests
 * read and write the way the renderer does.
 */
export const startHeadlessDesktop = async ({
	profileDir,
	exportDirectory,
	onEffectDropped,
	onProxyChanged,
	observeWindowMessages,
}: StartHeadlessDesktopOptions): Promise<HeadlessDesktop> => {
	const ipc = createFakeIpc();
	const handlers = new Map<string, (request: Request) => Promise<Response>>();
	const utility = createFakeUtilityProcess();
	const app = await startDesktopApp({
		profileDir,
		rendererDir: profileDir,
		mediaServiceEntryPath: "media.mjs",
		exportDirectory,
		electron: {
			ipcMain: ipc as never,
			protocol: {
				handle: (scheme: string, handler: unknown) => {
					handlers.set(scheme, handler as (request: Request) => Promise<Response>);
				},
			},
			MessageChannelMain: FakeMessageChannelMain as never,
			utilityProcess: utility.api,
		},
		onEffectDropped,
		onProxyChanged,
		observeWindowMessages,
	});
	const entryUrl = `${MINICUT_APP_URL_PREFIX}index.html`;
	const pages = new Set<PageSyncRuntime>();
	return {
		app,
		openWindow(webContentsId) {
			const fake = createFakeWindow(webContentsId, entryUrl);
			ipc.emit(ELECTRON_IPC.CONNECT, fake.event());
			const handshake = fake.posted.at(-1);
			if (!handshake || handshake.reply.error !== undefined) {
				throw new Error("window was not connected");
			}
			const transport = createPortTransport<MiniCutDktTransportMessage>(
				handshake.ports[0] as MessagePort as never,
			);
			const page = createMiniCutPageSyncRuntime({ transport });
			pages.add(page);
			page.bootstrap({
				sessionKey: handshake.reply.sessionKey,
				sessionId: handshake.reply.sessionId,
			});
			return {
				page,
				stage(paths) {
					const event = fake.event();
					ipc.emit(ELECTRON_IPC.IMPORT_STAGE, event, [...paths]);
					return event.returnValue as DesktopImportStaging;
				},
				close() {
					pages.delete(page);
					page.destroy();
				},
			};
		},
		serve: (url) => {
			const handler = handlers.get("minicut");
			if (!handler) throw new Error("the minicut protocol is not installed");
			return handler(new Request(new URL(url, entryUrl)));
		},
		async dispose() {
			for (const page of [...pages]) page.destroy();
			pages.clear();
			await app.dispose();
		},
	};
};
