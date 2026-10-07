import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	DKT_MSG,
	DKT_TEST_MSG,
	type MiniCutDktTransportMessage,
} from "../../../dkt/shared/messageTypes";
import { ensureFixtures } from "../../../media/node/testing/mediaFixtures";
import {
	createAssetUrl,
	ELECTRON_IPC,
	MINICUT_APP_URL_PREFIX,
	type DesktopImportStaging,
} from "../shared/ipcChannels";
import { createFakeMessageChannelMain } from "../testing/fakeElectron";
import { createFakeUtilityProcess, type FakeUtilityProcess } from "../testing/fakeUtilityProcess";
import {
	createFakeIpc,
	createFakeWindow,
	openRendererEnd,
} from "../testing/fakeWindows";
import { startDesktopApp, type DesktopApp } from "./desktopApp";

class FakeMessageChannelMain {
	readonly port1;
	readonly port2;
	constructor() {
		const channel = createFakeMessageChannelMain();
		this.port1 = channel.port1;
		this.port2 = channel.port2;
	}
}

const ENTRY_URL = `${MINICUT_APP_URL_PREFIX}index.html`;

type WindowEnd = ReturnType<typeof openRendererEnd>;
type TestWindow = WindowEnd & {
	webContentsId: number;
	stage(paths: string[]): DesktopImportStaging;
};

describe("desktop app composition (configuration B)", () => {
	let tempDir: string;
	let app: DesktopApp;
	let ipc: ReturnType<typeof createFakeIpc>;
	let utility: FakeUtilityProcess;
	let fixtures: Record<string, string>;
	const protocolHandlers = new Map<string, unknown>();
	let droppedEffects: Array<{ type: string; reason: string }>;
	let dropWaiters: Array<{ type: string; resolve: () => void }>;
	const waitForDropped = (type: string): Promise<void> =>
		new Promise((resolve) => {
			if (droppedEffects.some((effect) => effect.type === type)) {
				resolve();
				return;
			}
			dropWaiters.push({ type, resolve });
		});

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr"]);
	});

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-desktop-app-"));
		ipc = createFakeIpc();
		utility = createFakeUtilityProcess();
		protocolHandlers.clear();
		droppedEffects = [];
		dropWaiters = [];
		app = await startDesktopApp({
			profileDir: path.join(tempDir, "profile"),
			rendererDir: path.join(tempDir, "renderer"),
			mediaServiceEntryPath: "media.mjs",
			exportDirectory: path.join(tempDir, "exports"),
			onEffectDropped: (type, reason) => {
				droppedEffects.push({ type, reason });
				for (const waiter of dropWaiters.filter((candidate) => candidate.type === type)) {
					waiter.resolve();
				}
			},
			electron: {
				ipcMain: ipc as never,
				protocol: {
					handle: (scheme: string, handler: unknown) => {
						protocolHandlers.set(scheme, handler);
					},
				},
				MessageChannelMain: FakeMessageChannelMain as never,
				utilityProcess: utility.api,
			},
		});
	});

	afterEach(async () => {
		await app.dispose();
		await rm(tempDir, { recursive: true, force: true });
	});

	const openWindow = async (id: number): Promise<TestWindow> => {
		const fake = createFakeWindow(id, ENTRY_URL);
		ipc.emit(ELECTRON_IPC.CONNECT, fake.event());
		const handshake = fake.posted.at(-1);
		if (!handshake || handshake.reply.error !== undefined) {
			throw new Error("window was not connected");
		}
		const end = openRendererEnd(handshake.ports[0] as MessagePort);
		end.transport.send({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: handshake.reply.sessionKey,
			sessionId: handshake.reply.sessionId,
		});
		await end.waitFor((m) => m.type === DKT_MSG.RUNTIME_READY);
		return Object.assign(end, {
			webContentsId: id,
			stage(paths: string[]) {
				const event = fake.event();
				ipc.emit(ELECTRON_IPC.IMPORT_STAGE, event, paths);
				return event.returnValue as DesktopImportStaging;
			},
		});
	};

	let sequence = 0;
	const settle = async (...windows: WindowEnd[]) => {
		sequence += 1;
		await Promise.all(
			windows.map(async (window, index) => {
				const requestId = `idle-${sequence}-${index}`;
				window.transport.send({ type: DKT_TEST_MSG.WAIT_IDLE, requestId });
				await window.waitFor(
					(m) => m.type === DKT_TEST_MSG.IDLE && m.requestId === requestId,
				);
			}),
		);
	};

	let requestSequence = 0;
	/** Dispatches and resolves once the runtime accepted (enqueued) the action. */
	const dispatch = async (
		window: WindowEnd,
		actionName: string,
		payload?: unknown,
	): Promise<void> => {
		requestSequence += 1;
		const requestId = `act-${requestSequence}`;
		window.transport.send({
			type: DKT_MSG.DISPATCH_ACTION,
			requestId,
			actionName,
			payload,
			scopeNodeId: null,
		});
		await window.waitFor(
			(m) => m.type === DKT_MSG.ACTION_ACCEPTED && m.requestId === requestId,
		);
	};

	const countOf = (window: WindowEnd, type: MiniCutDktTransportMessage["type"]) =>
		window.received.filter((message) => message.type === type).length;

	const rootOf = (window: WindowEnd): string =>
		String(
			(window.received.find((m) => m.type === DKT_MSG.RUNTIME_READY) as { rootNodeId?: string })
				.rootNodeId,
		);
	/** The app root's pool of session roots and the projects they look at. */
	const appPool = async () => {
		const dump = (await app.host.runtime.debugDumpState(app.host.identity.roomId)) as {
			workerState?: {
				runtimeModels?: Array<{ modelName: string | null; rels: Record<string, unknown> }>;
			};
		};
		const appRoot = dump.workerState?.runtimeModels?.find((model) => model.modelName === "app_root");
		const ids = (rel: unknown): string[] => (Array.isArray(rel) ? (rel as string[]) : []);
		return {
			sessions: ids(appRoot?.rels.sessions),
			attendedProjects: ids(appRoot?.rels.attendedProject),
		};
	};

	it("registers each window as a session, attends its project, and releases both when it closes", async () => {
		const first = await openWindow(1);
		const second = await openWindow(2);
		await settle(first, second);

		const open = await appPool();
		expect(open.sessions.sort()).toEqual([rootOf(first), rootOf(second)].sort());
		// Both windows look at the shared project: one attended project, not two.
		expect(open.attendedProjects).toHaveLength(1);

		(first.transport as { destroy(): void }).destroy();
		const detached = new Promise<void>((resolve) => {
			const stop = app.windows.onConnectedWindowsChanged(() => {
				if (app.windows.getConnectedWindows().length === 1) {
					stop();
					resolve();
				}
			});
		});
		await detached;
		await settle(second);

		expect((await appPool()).sessions).toEqual([rootOf(second)]);
	});

	it("serves the minicut protocol with the app assets handler installed", () => {
		expect(protocolHandlers.has("minicut")).toBe(true);
	});

	it("runs the media service in a utility process for the life of the app", async () => {
		expect(utility.running()).toBe(1);
		await expect(app.media.capabilities()).resolves.toMatchObject({
			formats: expect.arrayContaining(["webm"]),
		});

		await app.dispose();

		expect(utility.running()).toBe(0);
	});

	it("drops an import batch no window staged and keeps running", async () => {
		const window = await openWindow(1);
		await dispatch(window, "createProject", { title: "Unknown batch" });
		await settle(window);

		await dispatch(window, "requestImportFiles", { inputBatchHandleId: "never-staged" });
		await waitForDropped("$fx_handleInputFiles");

		expect(droppedEffects).toContainEqual({
			type: "$fx_handleInputFiles",
			reason: "no window staged this import batch",
		});
		expect(app.assets.list()).toEqual([]);
		await expect(app.media.capabilities()).resolves.toBeTruthy();
	});

	it("never sends import, export or media recovery requests to a window", async () => {
		const window = await openWindow(1);
		await dispatch(window, "createProject", { title: "Host only" });
		await settle(window);

		// Both requests end in the host page's executors, which drop them
		// (no staged batch, no such session): nothing is sent to the window.
		await dispatch(window, "requestImportFiles", { inputBatchHandleId: "never-staged" });
		await dispatch(window, "requestProjectExport", { id: "export:host-only", initiatedBy: "other-root" });
		await waitForDropped("$fx_handleInputFiles");
		await waitForDropped("$fx_renderExport");
		await settle(window);

		expect(countOf(window, DKT_MSG.IMPORT_FILES_REQUEST)).toBe(0);
		expect(countOf(window, DKT_MSG.EXPORT_REQUEST)).toBe(0);
		expect(countOf(window, DKT_MSG.EXPORT_CANCEL_REQUEST)).toBe(0);
		expect(countOf(window, DKT_MSG.MEDIA_RECOVERY_REQUEST)).toBe(0);
	});

	it("refuses staging from untrusted pages and non-media paths", async () => {
		const window = await openWindow(1);
		const foreign = createFakeWindow(9, "https://example.com/");
		const untrusted = foreign.event();
		ipc.emit(ELECTRON_IPC.IMPORT_STAGE, untrusted, [fixtures["video-cfr"]]);

		expect(untrusted.returnValue).toEqual({ ok: false, reason: "untrusted sender" });
		expect(window.stage([path.join(tempDir, "notes.txt")])).toMatchObject({ ok: false });
		expect(window.stage(["\\\\server\\share\\clip.mp4"])).toMatchObject({ ok: false });
		expect(window.stage(["relative/clip.mp4"])).toMatchObject({ ok: false });
	});

	it("refuses staging from a window that has no session yet", () => {
		const fake = createFakeWindow(5, ENTRY_URL);
		ipc.emit(ELECTRON_IPC.CONNECT, fake.event());
		const event = fake.event();

		ipc.emit(ELECTRON_IPC.IMPORT_STAGE, event, [fixtures["video-cfr"]]);

		expect(event.returnValue).toEqual({ ok: false, reason: "the window has no session yet" });
	});
});
