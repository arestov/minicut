import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IpcMainEvent } from "electron";
import { startNodeMiniCutHost, type NodeMiniCutHost } from "../../../adapters/node/startNodeMiniCutHost";
import { createEffectContractFakes } from "../../../dkt/test/effectContractFakes";
import { createPortTransport } from "../../../dkt/shared/createPortTransport";
import {
	DKT_MSG,
	DKT_TEST_MSG,
	type MiniCutDktTransportMessage,
} from "../../../dkt/shared/messageTypes";
import { ELECTRON_IPC, type DesktopHandshakeReply } from "../shared/ipcChannels";
import { createFakeMessageChannelMain } from "../testing/fakeElectron";
import { createWindowConnector, createWindowSessionId } from "./windowConnector";

const TRUSTED_URL = "minicut-test://renderer/index.html";

type Posted = { channel: string; reply: DesktopHandshakeReply; ports: unknown[] };

const createFakeIpc = () => {
	const listeners = new Map<string, Set<(event: IpcMainEvent) => void>>();
	return {
		on(channel: string, listener: (event: IpcMainEvent) => void) {
			const set = listeners.get(channel) ?? new Set();
			set.add(listener);
			listeners.set(channel, set);
		},
		removeListener(channel: string, listener: (event: IpcMainEvent) => void) {
			listeners.get(channel)?.delete(listener);
		},
		listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0,
		emit(channel: string, event: unknown) {
			for (const listener of [...(listeners.get(channel) ?? [])]) {
				listener(event as IpcMainEvent);
			}
		},
	};
};

const createFakeWindow = (id: number, url = TRUSTED_URL) => {
	const posted: Posted[] = [];
	const mainFrame = { url };
	const sender = {
		id,
		mainFrame,
		postMessage(channel: string, reply: DesktopHandshakeReply, ports: unknown[]) {
			posted.push({ channel, reply, ports });
		},
	};
	return {
		posted,
		sender,
		event: (frame: unknown = mainFrame) => ({ sender, senderFrame: frame }),
	};
};

/** Renderer-side view of a window channel: collects replies, waits by predicate. */
const openRendererEnd = (port: MessagePort) => {
	const transport = createPortTransport<MiniCutDktTransportMessage>(port as never);
	const received: MiniCutDktTransportMessage[] = [];
	const waiters = new Set<{
		predicate: (message: MiniCutDktTransportMessage) => boolean;
		resolve: (message: MiniCutDktTransportMessage) => void;
	}>();
	transport.listen((message) => {
		received.push(message);
		for (const waiter of [...waiters]) {
			if (waiter.predicate(message)) {
				waiters.delete(waiter);
				waiter.resolve(message);
			}
		}
	});
	const waitFor = (predicate: (message: MiniCutDktTransportMessage) => boolean) =>
		new Promise<MiniCutDktTransportMessage>((resolve) => {
			const existing = received.find(predicate);
			if (existing) {
				resolve(existing);
				return;
			}
			waiters.add({ predicate, resolve });
		});
	return { transport, received, waitFor };
};

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
		await host.dispose();
		await rm(tempDir, { recursive: true, force: true });
	});

	const startConnector = () => {
		const ipc = createFakeIpc();
		const connector = createWindowConnector({
			runtime: host.runtime,
			sessionKey: host.identity.roomId,
			createMessageChannel: createFakeMessageChannelMain,
			ipcMain: ipc,
			isTrustedRendererUrl: (url) => url.startsWith("minicut-test://renderer/"),
		});
		connectorDispose = () => connector.dispose();
		return { ipc };
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
		return { handshake: handshake.reply, ...end };
	};

	const bootstrapWindow = async (id: number) => {
		const { ipc } = startConnector();
		const window = connectWindow(ipc, createFakeWindow(id));
		const { handshake } = window;
		if (handshake.error !== undefined) {
			throw new Error(handshake.error);
		}
		window.transport.send({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: handshake.sessionKey,
			sessionId: handshake.sessionId,
		});
		await window.waitFor((m) => m.type === DKT_MSG.RUNTIME_READY);
		return window;
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
});
