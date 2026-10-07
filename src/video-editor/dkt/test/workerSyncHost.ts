import { parentPort } from "node:worker_threads";
import { createMiniCutDktRuntime } from "../runtime/createMiniCutDktRuntime";
import type { DomSyncPortLike } from "dkt/dom-sync/transport.js";
import { createPortTransport } from "../shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../shared/messageTypes";
import { createEffectContractFakes } from "./effectContractFakes";

// Test host: the real MiniCut DKT runtime on memory storage inside a
// worker_threads worker, reachable only through the worker's MessagePort.
if (!parentPort) {
	throw new Error("workerSyncHost must run inside a worker thread");
}

const fakes = createEffectContractFakes();
const runtime = createMiniCutDktRuntime({
	enabled: true,
	effectInterfaces: fakes.interfaces,
	crdt: { enabled: true, testOnly: true, storage: "memory", transport: null },
});
runtime.connect(
	createPortTransport<MiniCutDktTransportMessage>(
		parentPort as unknown as DomSyncPortLike<MiniCutDktTransportMessage>,
	),
);
