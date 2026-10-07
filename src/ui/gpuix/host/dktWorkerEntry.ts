import { type MessagePort, parentPort } from "node:worker_threads";
import type { DomSyncPortLike } from "dkt/dom-sync/transport.js";
import { createBrowserEffectInterfaces } from "../../../video-editor/adapters/web/createBrowserEffectInterfaces";
import {
	startNodeMiniCutHost,
	type NodeMiniCutHost,
} from "../../../video-editor/adapters/node/startNodeMiniCutHost";
import { createPortTransport } from "../../../video-editor/dkt/shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../../../video-editor/dkt/shared/messageTypes";
import type {
	DktWorkerInbound,
	DktWorkerOutbound,
} from "./workerProtocol";

/**
 * DKT worker entry (worker_threads, Bun). It owns the real MiniCut DKT runtime
 * on LevelDB in the profile directory. The effect interfaces are the ones the
 * Web SharedWorker uses: every effect request is published to the connected
 * window (here: the main thread) over the DKT port, where the GPUIX-side
 * executors run it. No domain logic and no media work lives in the worker.
 */
if (!parentPort) {
	throw new Error("dktWorkerEntry must run inside a worker thread");
}
const control = parentPort;

const post = (message: DktWorkerOutbound): void => {
	control.postMessage(message);
};

let host: NodeMiniCutHost | null = null;
let starting = false;

const fail = (error: unknown): void => {
	const value = error as { name?: unknown; message?: unknown; code?: unknown };
	post({
		type: "minicut-host:failed",
		name: typeof value?.name === "string" ? value.name : "Error",
		message:
			typeof value?.message === "string" ? value.message : String(error),
		...(typeof value?.code === "string" ? { code: value.code } : {}),
	});
};

const start = async (profileDir: string, port: MessagePort): Promise<void> => {
	const transport = createPortTransport<MiniCutDktTransportMessage>(
		port as unknown as DomSyncPortLike<MiniCutDktTransportMessage>,
	);
	const pages = new Set([transport]);
	host = await startNodeMiniCutHost({
		profileDir,
		effectInterfaces: createBrowserEffectInterfaces({
			pages,
			log: () => undefined,
		}),
	});
	host.runtime.connect(transport);
	post({ type: "minicut-host:ready", identity: host.identity });
};

control.on("message", (message: DktWorkerInbound) => {
	if (message?.type === "minicut-host:init") {
		if (starting) return;
		starting = true;
		start(message.profileDir, message.port).catch(fail);
		return;
	}
	if (message?.type === "minicut-host:dispose") {
		const current = host;
		host = null;
		(current?.dispose() ?? Promise.resolve()).then(
			() => post({ type: "minicut-host:disposed" }),
			(error: unknown) =>
				post({
					type: "minicut-host:disposed",
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	}
});
