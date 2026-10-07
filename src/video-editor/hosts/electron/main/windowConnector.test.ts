import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startNodeMiniCutHost, type NodeMiniCutHost } from "../../../adapters/node/startNodeMiniCutHost";
import { createEffectContractFakes } from "../../../dkt/test/effectContractFakes";
import { DKT_MSG, DKT_TEST_MSG } from "../../../dkt/shared/messageTypes";
import { ELECTRON_IPC, type DesktopHandshakeReply } from "../shared/ipcChannels";
import { createFakeMessageChannelMain } from "../testing/fakeElectron";
import {
	createFakeIpc,
	createFakeWindow,
	openRendererEnd,
	TRUSTED_TEST_URL as TRUSTED_URL,
} from "../testing/fakeWindows";
import { createWindowConnector, createWindowSessionId, isUrlUnderPrefix } from "./windowConnector";

describe("Electron window connector", () => {
	let tempDir: string;
	let host: NodeMiniCutHost;
	let connectorDispose: (() => void) | null = null;
	const openTransports: { destroy(): void }[] = [];

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-window-connector-"));
		host = await startNodeMiniCutHost({
			profileDir: path.join(tempDir, "profile"),
			effectInterfaces: createEffectContractFakes().interfaces,
		});
	});

	afterEach(async () => {
		for (const transport of openTransports.splice(0)) {
			transport.destroy();
		}
		connectorDispose?.();
		connectorDispose = null;
		current = null;
		await host.dispose();
		await rm(tempDir, { recursive: true, force: true });
	});

	let current: {
		ipc: ReturnType<typeof createFakeIpc>;
		connector: ReturnType<typeof createWindowConnector>;
	} | null = null;
	const startConnector = () => {
		if (current) {
			return current;
		}
		const ipc = createFakeIpc();
		const connector = createWindowConnector({
			runtime: host.runtime,
			sessionKey: host.identity.roomId,
			createMessageChannel: createFakeMessageChannelMain,
			ipcMain: ipc,
			isTrustedRendererUrl: (url) => url.startsWith("minicut-test://renderer/"),
		});
		connectorDispose = () => connector.dispose();
		current = { ipc, connector };
		return current;
	};

	const connectWindow = (
		ipc: ReturnType<typeof createFakeIpc>,
		window: ReturnType<typeof createFakeWindow>,
	) => {
		ipc.emit(ELECTRON_IPC.CONNECT, window.event());
		const handshake = window.posted.at(-1);
		if (!handshake || handshake.reply.error !== undefined) {
			throw new Error("window did not receive a handshake with a port");
		}
		const channel = (handshake.ports[0] ?? null) as MessagePort | null;
		if (!channel) {
			throw new Error("handshake carried no port");
		}
		const end = openRendererEnd(channel);
		openTransports.push(end.transport);
		return { handshake: handshake.reply, port: channel, ...end };
	};

	const bootstrapWindow = async (
		id: number,
		fakeWindow = createFakeWindow(id),
	) => {
		const { ipc } = startConnector();
		const window = connectWindow(ipc, fakeWindow);
		const { handshake } = window;
		if (handshake.error !== undefined) {
			throw new Error(handshake.error);
		}
		window.transport.send({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: handshake.sessionKey,
			sessionId: handshake.sessionId,
		});
		const ready = (await window.waitFor(
			(m) => m.type === DKT_MSG.RUNTIME_READY,
		)) as { rootNodeId?: string };
		return { ...window, ready };
	};

	it("ignores connect requests from untrusted pages and non-main frames", () => {
		const { ipc } = startConnector();
		const foreign = createFakeWindow(1, "https://example.com/");
		const framed = createFakeWindow(2);

		ipc.emit(ELECTRON_IPC.CONNECT, foreign.event());
		ipc.emit(ELECTRON_IPC.CONNECT, framed.event({ url: TRUSTED_URL }));
		ipc.emit(ELECTRON_IPC.CONNECT, { sender: framed.sender, senderFrame: null });

		expect(foreign.posted).toEqual([]);
		expect(framed.posted).toEqual([]);
	});

	it("hands the window a port and the session ids owned by main", () => {
		const { ipc } = startConnector();
		const window = createFakeWindow(7);

		const { handshake } = connectWindow(ipc, window);

		expect(window.posted[0].channel).toBe(ELECTRON_IPC.PORT);
		expect(handshake).toEqual({
			sessionKey: host.identity.roomId,
			sessionId: createWindowSessionId(host.identity.roomId, 7),
		});
	});

	it("bootstraps a window over the port and delivers the initial sync", async () => {
		const { ipc } = startConnector();
		const { handshake, transport, waitFor, received } = connectWindow(
			ipc,
			createFakeWindow(7),
		);
		if (handshake.error !== undefined) throw new Error(handshake.error);

		transport.send({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: handshake.sessionKey,
			sessionId: handshake.sessionId,
		});
		const ready = await waitFor((m) => m.type === DKT_MSG.RUNTIME_READY);

		expect(ready).toMatchObject({
			sessionId: handshake.sessionId,
			sessionKey: handshake.sessionKey,
		});
		expect((ready as { rootNodeId?: string }).rootNodeId).toEqual(expect.any(String));
		expect(received.some((m) => m.type === DKT_MSG.SYNC_HANDLE)).toBe(true);
	});

	it("accepts dispatched actions and shows the result in a separate read step", async () => {
		const { transport, waitFor } = await bootstrapWindow(7);

		transport.send({
			type: DKT_MSG.DISPATCH_ACTION,
			requestId: "act-1",
			actionName: "createProject",
			payload: { title: "Over the port" },
		});
		const accepted = await waitFor(
			(m) => m.type === DKT_MSG.ACTION_ACCEPTED && m.requestId === "act-1",
		);
		transport.send({ type: DKT_TEST_MSG.WAIT_IDLE, requestId: "idle-1" });
		await waitFor((m) => m.type === DKT_TEST_MSG.IDLE && m.requestId === "idle-1");
		transport.send({ type: DKT_TEST_MSG.DEBUG_DUMP_REQUEST, requestId: "dump-1" });
		const dump = (await waitFor(
			(m) => m.type === DKT_TEST_MSG.DEBUG_DUMP_RESPONSE && m.requestId === "dump-1",
		)) as { dump: { runtimeModels?: { modelName: string | null }[] } };

		expect(accepted).toMatchObject({ actionName: "createProject" });
		expect(
			dump.dump.runtimeModels?.filter((model) => model.modelName === "project").length,
		).toBeGreaterThan(0);
	});

	it("reports an action failure with its requestId as a runtime error", async () => {
		const { transport, waitFor } = await bootstrapWindow(7);

		transport.send({
			type: DKT_MSG.DISPATCH_ACTION,
			requestId: "act-bad",
			actionName: "createProject",
			scopeNodeId: "missing-node",
		});
		const error = await waitFor(
			(m) => m.type === DKT_MSG.RUNTIME_ERROR && m.requestId === "act-bad",
		);

		expect(error).toMatchObject({ type: DKT_MSG.RUNTIME_ERROR, requestId: "act-bad" });
		expect(String((error as { message: unknown }).message)).toContain("missing-node");
	});

	it("delivers messages that carry a data field intact (shape requests)", async () => {
		const { transport, waitFor, received } = await bootstrapWindow(7);

		transport.send({
			type: DKT_MSG.SYNC_REQUIRE_SHAPE,
			data: { node_id: "unknown-node", activation_id: "a1", shape_ids: ["s1"] },
		});
		transport.send({
			type: DKT_MSG.DISPATCH_ACTION,
			requestId: "after-shape",
			actionName: "createProject",
		});
		await waitFor(
			(m) => m.type === DKT_MSG.ACTION_ACCEPTED && m.requestId === "after-shape",
		);

		// Messages are handled in order, so a malformed shape request would
		// already have produced its error before the later action was accepted.
		expect(received.filter((m) => m.type === DKT_MSG.RUNTIME_ERROR)).toEqual([]);
	});

	it("answers a refused runtime connection with an error and no port", () => {
		const ipc = createFakeIpc();
		const connector = createWindowConnector({
			runtime: {
				connect() {
					throw new Error("MiniCut DKT runtime is disposed");
				},
			},
			sessionKey: "room",
			createMessageChannel: createFakeMessageChannelMain,
			ipcMain: ipc,
			isTrustedRendererUrl: () => true,
		});
		const window = createFakeWindow(3);

		ipc.emit(ELECTRON_IPC.CONNECT, window.event());
		connector.dispose();

		expect(window.posted).toEqual([
			{
				channel: ELECTRON_IPC.PORT,
				reply: { error: "MiniCut DKT runtime is disposed" },
				ports: [],
			},
		]);
		expect(ipc.listenerCount(ELECTRON_IPC.CONNECT)).toBe(0);
	});
	describe("window sessions", () => {
		const closedPort = (port: MessagePort) =>
			new Promise<void>((resolve) => port.once("close", () => resolve()));
		const sessionIdOf = (reply: DesktopHandshakeReply) => {
			if (reply.error !== undefined) throw new Error(reply.error);
			return reply.sessionId;
		};

		it("keeps the session mapping on reload and replaces the connection", async () => {
			const fakeWindow = createFakeWindow(7);
			const first = await bootstrapWindow(7, fakeWindow);
			const firstClosed = closedPort(first.port);

			const { ipc, connector } = startConnector();
			const second = connectWindow(ipc, fakeWindow);
			second.transport.send({
				type: DKT_MSG.BOOTSTRAP,
				sessionKey: host.identity.roomId,
				sessionId: sessionIdOf(second.handshake),
			});
			const ready = (await second.waitFor(
				(m) => m.type === DKT_MSG.RUNTIME_READY,
			)) as { rootNodeId?: string };
			await firstClosed;

			expect(sessionIdOf(second.handshake)).toBe(sessionIdOf(first.handshake));
			expect(ready.rootNodeId).toBe(first.ready.rootNodeId);
			expect(connector.getConnectedWindows()).toMatchObject([
				{ sessionId: sessionIdOf(first.handshake), webContentsId: 7 },
			]);
		});

		it("detaches a window when it is destroyed and closes its port", async () => {
			const fakeWindow = createFakeWindow(7);
			const window = await bootstrapWindow(7, fakeWindow);
			const closed = closedPort(window.port);

			fakeWindow.sender.emit("destroyed");
			await closed;

			expect(startConnector().connector.getConnectedWindows()).toEqual([]);
		});

		it("detaches when the renderer process is gone or the main frame navigates away", async () => {
			const crashed = createFakeWindow(1);
			const navigated = createFakeWindow(2);
			const sameDocument = createFakeWindow(3);
			const subframe = createFakeWindow(4);
			for (const [id, fake] of [
				[1, crashed],
				[2, navigated],
				[3, sameDocument],
				[4, subframe],
			] as const) {
				await bootstrapWindow(id, fake);
			}

			crashed.sender.emit("render-process-gone", {}, { reason: "crashed" });
			navigated.sender.emit("did-start-navigation", {
				isMainFrame: true,
				isSameDocument: false,
			});
			sameDocument.sender.emit("did-start-navigation", {
				isMainFrame: true,
				isSameDocument: true,
			});
			subframe.sender.emit("did-start-navigation", {
				isMainFrame: false,
				isSameDocument: false,
			});

			expect(
				startConnector()
					.connector.getConnectedWindows()
					.map((entry) => entry.webContentsId),
			).toEqual([3, 4]);
		});

		it("detaches when the renderer end of the port closes", async () => {
			const window = await bootstrapWindow(7);

			const { connector } = startConnector();
			const detached = new Promise<void>((resolve) => {
				connector.onConnectedWindowsChanged(() => {
					if (connector.getConnectedWindows().length === 0) resolve();
				});
			});

			window.port.close();
			await detached;

			expect(connector.getConnectedWindows()).toEqual([]);
		});

		it("gives each window its own session on the same room and orders them by connection", async () => {
			const a = createFakeWindow(5);
			const b = createFakeWindow(6);
			const first = await bootstrapWindow(5, a);
			const second = await bootstrapWindow(6, b);

			expect(sessionIdOf(first.handshake)).not.toBe(sessionIdOf(second.handshake));
			expect(startConnector().connector.getConnectedWindows().map((w) => w.webContentsId)).toEqual([5, 6]);

			a.sender.emit("destroyed");

			expect(startConnector().connector.getConnectedWindows().map((w) => w.webContentsId)).toEqual([6]);
		});
	});
	describe("task ownership", () => {
		it("records the session root id each window received in RUNTIME_READY", async () => {
			const window = await bootstrapWindow(7);

			expect(startConnector().connector.getConnectedWindows()[0].rootNodeId).toBe(
				window.ready.rootNodeId,
			);
		});
	});

	describe("host actions", () => {
		const connectedWindow = (webContentsId: number) => {
			const found = startConnector()
				.connector.getConnectedWindows()
				.find((window) => window.webContentsId === webContentsId);
			if (!found) throw new Error(`window ${webContentsId} is not connected`);
			return found;
		};
		type Model = { modelName: string | null; attrs: Record<string, unknown> };
		let dumpSequence = 0;
		const modelsOf = async (window: Awaited<ReturnType<typeof bootstrapWindow>>) => {
			// A separate read step: wait until the runtime has applied what was enqueued.
			dumpSequence += 1;
			const idleId = `idle-${dumpSequence}`;
			window.transport.send({ type: DKT_TEST_MSG.WAIT_IDLE, requestId: idleId });
			await window.waitFor((m) => m.type === DKT_TEST_MSG.IDLE && m.requestId === idleId);
			const requestId = `dump-${dumpSequence}`;
			window.transport.send({ type: DKT_TEST_MSG.DEBUG_DUMP_REQUEST, requestId });
			const reply = (await window.waitFor(
				(m) => m.type === DKT_TEST_MSG.DEBUG_DUMP_RESPONSE && m.requestId === requestId,
			)) as unknown as { dump: { runtimeModels?: Model[] } };
			return reply.dump.runtimeModels ?? [];
		};

		it("runs an action as the window's own session and keeps the reply to itself", async () => {
			const window = await bootstrapWindow(5);
			const projectsBefore = (await modelsOf(window)).filter((m) => m.modelName === "project");

			await connectedWindow(5).dispatchAndWait({ actionName: "createProject" });

			const projectsAfter = (await modelsOf(window)).filter((m) => m.modelName === "project");
			expect(projectsAfter).toHaveLength(projectsBefore.length + 1);
			expect(
				window.received.filter(
					(m) => (m as { requestId?: string }).requestId?.startsWith("minicut-host:"),
				),
			).toEqual([]);
		});

		it("adds no session of its own", async () => {
			const window = await bootstrapWindow(5);
			const before = (await modelsOf(window)).filter((m) => m.modelName === "session_root");

			await connectedWindow(5).dispatchAndWait({
				actionName: "createProject",
				payload: { title: "Another" },
			});

			const after = (await modelsOf(window)).filter((m) => m.modelName === "session_root");
			expect(after).toHaveLength(before.length);
		});

		it("rejects with the runtime's error and does not show it to the window", async () => {
			const window = await bootstrapWindow(5);

			await expect(
				connectedWindow(5).dispatchAndWait({
					actionName: "createProject",
					scopeNodeId: "no-such-node",
				}),
			).rejects.toThrow(/scope was not found/);

			expect(window.received.filter((m) => m.type === DKT_MSG.RUNTIME_ERROR)).toEqual([]);
		});

		it("reports a failed fire-and-forget action to the host, not to the window", async () => {
			const errors: string[] = [];
			let signalFailed: () => void = () => undefined;
			const failed = new Promise<void>((resolve) => {
				signalFailed = resolve;
			});
			const { ipc } = (() => {
				const ipc = createFakeIpc();
				const connector = createWindowConnector({
					runtime: host.runtime,
					sessionKey: host.identity.roomId,
					createMessageChannel: createFakeMessageChannelMain,
					ipcMain: ipc,
					isTrustedRendererUrl: (url) => url.startsWith("minicut-test://renderer/"),
					onHostActionError: (_window, action, error) => {
						errors.push(`${action.actionName}: ${error.message}`);
						signalFailed();
					},
				});
				connectorDispose = () => connector.dispose();
				current = { ipc, connector };
				return current;
			})();
			const connected = connectWindow(ipc, createFakeWindow(6));
			if (connected.handshake.error !== undefined) throw new Error(connected.handshake.error);
			connected.transport.send({
				type: DKT_MSG.BOOTSTRAP,
				sessionKey: connected.handshake.sessionKey,
				sessionId: connected.handshake.sessionId,
			});
			await connected.waitFor((m) => m.type === DKT_MSG.RUNTIME_READY);
			current.connector.getConnectedWindows()[0].dispatch({
				actionName: "createProject",
				scopeNodeId: "no-such-node",
			});
			await failed;

			expect(errors).toEqual([expect.stringMatching(/^createProject: [^]*scope was not found/)]);
			expect(connected.received.filter((m) => m.type === DKT_MSG.RUNTIME_ERROR)).toEqual([]);
		});

		it("rejects an action for a window whose connection is gone", async () => {
			const fakeWindow = createFakeWindow(5);
			await bootstrapWindow(5, fakeWindow);
			const window = connectedWindow(5);
			fakeWindow.sender.emit("destroyed");

			await expect(
				window.dispatchAndWait({ actionName: "createProject" }),
			).rejects.toThrow();
		});
	});

	describe("trusted URL prefixes", () => {
		it("matches the prefix only at a path, query or hash boundary", () => {
			const dev = "http://localhost:5173";

			expect(isUrlUnderPrefix("http://localhost:5173", dev)).toBe(true);
			expect(isUrlUnderPrefix("http://localhost:5173/app", dev)).toBe(true);
			expect(isUrlUnderPrefix("http://localhost:5173?x=1", dev)).toBe(true);
			expect(isUrlUnderPrefix("http://localhost:5173.evil.com/", dev)).toBe(false);
			expect(isUrlUnderPrefix("http://localhost:51730/", dev)).toBe(false);
			expect(isUrlUnderPrefix("minicut://local/app/index.html", "minicut://local/app/")).toBe(true);
			expect(isUrlUnderPrefix("minicut://local/application", "minicut://local/app/")).toBe(false);
		});
	});
	describe("task ownership", () => {
		it("records the session root id each window received in RUNTIME_READY", async () => {
			const window = await bootstrapWindow(7);

			expect(startConnector().connector.getConnectedWindows()[0].rootNodeId).toBe(
				window.ready.rootNodeId,
			);
		});
	});

	describe("trusted URL prefixes", () => {
		it("matches the prefix only at a path, query or hash boundary", () => {
			const dev = "http://localhost:5173";

			expect(isUrlUnderPrefix("http://localhost:5173", dev)).toBe(true);
			expect(isUrlUnderPrefix("http://localhost:5173/app", dev)).toBe(true);
			expect(isUrlUnderPrefix("http://localhost:5173?x=1", dev)).toBe(true);
			expect(isUrlUnderPrefix("http://localhost:5173.evil.com/", dev)).toBe(false);
			expect(isUrlUnderPrefix("http://localhost:51730/", dev)).toBe(false);
			expect(isUrlUnderPrefix("minicut://local/app/index.html", "minicut://local/app/")).toBe(true);
			expect(isUrlUnderPrefix("minicut://local/application", "minicut://local/app/")).toBe(false);
		});
	});
});
