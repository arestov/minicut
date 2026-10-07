import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DKT_MSG,
	DKT_TEST_MSG,
	type MiniCutDktTransportMessage,
} from "../../../dkt/shared/messageTypes";
import { ELECTRON_IPC } from "../shared/ipcChannels";
import { createFakeMessageChannelMain } from "../testing/fakeElectron";
import {
	createFakeIpc,
	createFakeWindow,
	openRendererEnd,
} from "../testing/fakeWindows";
import { startDesktopApp, type DesktopApp } from "./desktopApp";
import { createWindowExecutorEffectInterfaces } from "./createWindowExecutorEffectInterfaces";
import { MINICUT_APP_URL_PREFIX } from "../shared/ipcChannels";

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

describe("desktop app composition (configuration A)", () => {
	let tempDir: string;
	let app: DesktopApp;
	let ipc: ReturnType<typeof createFakeIpc>;
	const protocolHandlers = new Map<string, unknown>();

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-desktop-app-"));
		ipc = createFakeIpc();
		protocolHandlers.clear();
		app = await startDesktopApp({
			profileDir: path.join(tempDir, "profile"),
			rendererDir: path.join(tempDir, "renderer"),
			electron: {
				ipcMain: ipc as never,
				protocol: {
					handle: (scheme: string, handler: unknown) => {
						protocolHandlers.set(scheme, handler);
					},
				},
				MessageChannelMain: FakeMessageChannelMain as never,
			},
		});
	});

	afterEach(async () => {
		await app.dispose();
		await rm(tempDir, { recursive: true, force: true });
	});

	const openWindow = async (id: number): Promise<WindowEnd> => {
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
		return end;
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

	it("serves the minicut protocol with the app assets handler installed", () => {
		expect(protocolHandlers.has("minicut")).toBe(true);
	});

	const sessionRootsOf = async (window: WindowEnd) => {
		window.transport.send({ type: DKT_TEST_MSG.DEBUG_DUMP_REQUEST, requestId: "dump" });
		const reply = (await window.waitFor(
			(m) => m.type === DKT_TEST_MSG.DEBUG_DUMP_RESPONSE,
		)) as {
			dump: { runtimeModels?: { modelName: string | null; attrs: Record<string, unknown> }[] };
		};
		return (reply.dump.runtimeModels ?? []).filter((model) => model.modelName === "session_root");
	};

	const payloadsOf = (window: WindowEnd, type: MiniCutDktTransportMessage["type"]) =>
		window.received
			.filter((message) => message.type === type)
			.map((message) => (message as { payload?: Record<string, unknown> }).payload ?? {});

	it("runs an export for the window that started it, and for that window only", async () => {
		const first = await openWindow(1);
		const second = await openWindow(2);
		await dispatch(first, "createProject", { title: "First window project" });
		await dispatch(second, "createProject", { title: "Second window project" });
		await settle(first, second);

		await dispatch(second, "requestProjectExport", { id: "export:from-second" });
		await settle(first, second);

		expect(countOf(first, DKT_MSG.EXPORT_REQUEST)).toBe(0);
		expect(countOf(second, DKT_MSG.EXPORT_REQUEST)).toBe(1);
		const roots = await sessionRootsOf(second);
		const progress = roots
			.map((root) => root.attrs.exportProgress as { id?: string; stage?: string } | null)
			.filter(Boolean);
		expect(progress).toEqual([expect.objectContaining({ id: "export:from-second" })]);
	});

	it("falls back to the oldest window when the export initiator is unknown", async () => {
		const first = await openWindow(1);
		const second = await openWindow(2);
		await dispatch(second, "createProject", { title: "Second window project" });
		await settle(first, second);

		await dispatch(second, "requestProjectExport", {
			id: "export:unknown-initiator",
			initiatedBy: "no-such-session-root",
		});
		await settle(first, second);

		expect(countOf(first, DKT_MSG.EXPORT_REQUEST)).toBe(1);
		expect(countOf(second, DKT_MSG.EXPORT_REQUEST)).toBe(0);
	});

	it("still serves the initiating window after another window went away", async () => {
		const first = await openWindow(1);
		const second = await openWindow(2);
		await dispatch(second, "createProject", { title: "Failover" });
		await settle(first, second);
		const detached = new Promise<void>((resolve) => {
			app.windows.onConnectedWindowsChanged(() => {
				if (app.windows.getConnectedWindows().length === 1) resolve();
			});
		});
		(first.transport as { destroy(): void }).destroy();
		await detached;

		await dispatch(second, "requestProjectExport", { id: "export:after-close" });
		await settle(second);

		expect(countOf(second, DKT_MSG.EXPORT_REQUEST)).toBe(1);
	});

	it("delivers an import only to the window that staged it, even with equal handle ids", async () => {
		const first = await openWindow(1);
		const second = await openWindow(2);
		await dispatch(first, "createProject", { title: "First" });
		await dispatch(second, "createProject", { title: "Second" });
		await settle(first, second);

		// Handle ids are per-window counters: both windows stage rt_tmp_1.
		await dispatch(first, "requestImportFiles", { inputBatchHandleId: "rt_tmp_1" });
		await dispatch(second, "requestImportFiles", { inputBatchHandleId: "rt_tmp_1" });
		await settle(first, second);

		expect(payloadsOf(first, DKT_MSG.IMPORT_FILES_REQUEST)).toHaveLength(1);
		expect(payloadsOf(second, DKT_MSG.IMPORT_FILES_REQUEST)).toHaveLength(1);
	});

	it("applies a playback run only in the window whose session started it", async () => {
		const first = await openWindow(1);
		const second = await openWindow(2);
		await dispatch(first, "createProject", { title: "First" });
		await dispatch(second, "createProject", { title: "Second" });
		await dispatch(first, "addTextClipToTimeline", {
			name: "Text",
			mediaKind: "text",
			start: 0,
			in: 0,
			duration: 3,
			text: { content: "Text" },
		});
		await settle(first, second);
		const rootOf = (window: WindowEnd) =>
			(window.received.find((m) => m.type === DKT_MSG.RUNTIME_READY) as { rootNodeId?: string })
				.rootNodeId;

		await dispatch(first, "play");
		await settle(first, second);

		const runsIn = (window: WindowEnd) => payloadsOf(window, DKT_MSG.PLAYBACK_RUN_REQUEST);
		// Every request a window gets belongs to its own session root ...
		expect(runsIn(first).every((p) => p.sessionRootNodeId === rootOf(first))).toBe(true);
		expect(runsIn(second).every((p) => p.sessionRootNodeId === rootOf(second))).toBe(true);
		// ... and only the window that pressed play was told to run.
		expect(runsIn(first).some((p) => p.run)).toBe(true);
		expect(runsIn(second).some((p) => p.run)).toBe(false);
	});

	it("does not run a task for a window twice after the window reconnects", async () => {
		const fake = createFakeWindow(1, ENTRY_URL);
		const connect = async () => {
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
			return end;
		};
		await connect();
		const reloaded = await connect();
		await dispatch(reloaded, "createProject", { title: "Reload" });
		await settle(reloaded);

		await dispatch(reloaded, "requestProjectExport", { id: "export:after-reload" });
		await settle(reloaded);

		expect(countOf(reloaded, DKT_MSG.EXPORT_REQUEST)).toBe(1);
	});
});

describe("window executor effect interfaces", () => {
	const createWindows = () => {
		const received: { window: string; type: string }[] = [];
		const make = (name: string, rootNodeId: string | null) => ({
			rootNodeId,
			transport: {
				send: (message: MiniCutDktTransportMessage) => {
					received.push({ window: name, type: message.type });
				},
			},
		});
		return { received, a: make("a", "root-a"), b: make("b", "root-b") };
	};
	const options = (
		windows: ReturnType<typeof createWindows>,
		extra: Partial<Parameters<typeof createWindowExecutorEffectInterfaces>[0]> = {},
	) => ({
		getWindows: () => [windows.a, windows.b],
		claimImportWindow: () => null,
		onDropped: () => undefined,
		...extra,
	});

	it("provides every interface the models call", () => {
		const interfaces = createWindowExecutorEffectInterfaces({
			getWindows: () => [],
			claimImportWindow: () => null,
			onDropped: () => undefined,
		});

		expect(Object.keys(interfaces).sort()).toEqual([
			"exportRuntime",
			"importRuntime",
			"mediaRecoveryRuntime",
			"playbackRuntime",
			"time",
		]);
	});

	it("routes each task to one window chosen from its payload", () => {
		const windows = createWindows();
		const interfaces = createWindowExecutorEffectInterfaces(
			options(windows, { claimImportWindow: () => windows.b }),
		);

		interfaces.exportRuntime.requestExport({ request: { id: "e1", initiatedBy: "root-b" } });
		interfaces.exportRuntime.requestExport({ request: { id: "e2", initiatedBy: "unknown" } });
		interfaces.mediaRecoveryRuntime.requestMediaRecovery({ taskId: "t1" });
		interfaces.importRuntime.requestImportFiles({ inputBatchHandleId: "b1" });
		interfaces.playbackRuntime.applyPlaybackRun({ sessionRootNodeId: "root-b", run: null });

		expect(windows.received).toEqual([
			{ window: "b", type: DKT_MSG.EXPORT_REQUEST },
			{ window: "a", type: DKT_MSG.EXPORT_REQUEST },
			{ window: "a", type: DKT_MSG.MEDIA_RECOVERY_REQUEST },
			{ window: "b", type: DKT_MSG.IMPORT_FILES_REQUEST },
			{ window: "b", type: DKT_MSG.PLAYBACK_RUN_REQUEST },
		]);
	});

	it("drops an import batch no window staged and reports it", () => {
		const windows = createWindows();
		const dropped: string[] = [];
		const interfaces = createWindowExecutorEffectInterfaces(
			options(windows, { onDropped: (type) => dropped.push(type) }),
		);

		interfaces.importRuntime.requestImportFiles({ inputBatchHandleId: "unknown" });

		expect(windows.received).toEqual([]);
		expect(dropped).toEqual([DKT_MSG.IMPORT_FILES_REQUEST]);
	});

	it("drops playback without an owning window, silently only while a window is still booting", () => {
		const windows = createWindows();
		const dropped: string[] = [];
		const booting = { ...windows.b, rootNodeId: null };
		const whileBooting = createWindowExecutorEffectInterfaces({
			getWindows: () => [windows.a, booting],
			claimImportWindow: () => null,
			onDropped: (type) => dropped.push(type),
		});
		const settled = createWindowExecutorEffectInterfaces(
			options(windows, { onDropped: (type) => dropped.push(type) }),
		);

		whileBooting.playbackRuntime.applyPlaybackRun({ sessionRootNodeId: "root-x", run: null });
		settled.playbackRuntime.applyPlaybackRun({ sessionRootNodeId: "root-x", run: null });

		expect(windows.received).toEqual([]);
		expect(dropped).toEqual([DKT_MSG.PLAYBACK_RUN_REQUEST]);
	});

	it("reports an effect that has no window to run in instead of dropping it silently", () => {
		const dropped: string[] = [];
		const interfaces = createWindowExecutorEffectInterfaces({
			getWindows: () => [],
			claimImportWindow: () => null,
			onDropped: (type) => dropped.push(type),
		});

		interfaces.exportRuntime.requestExport({ request: { id: "e1" } });

		expect(dropped).toEqual([DKT_MSG.EXPORT_REQUEST]);
	});
});
