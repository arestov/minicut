import type { MessagePort } from "node:worker_threads";
import type { NodeProfileIdentity } from "../../../video-editor/adapters/node/nodeProfileIdentity";

/**
 * Control messages between the main Bun thread and the DKT worker. They travel
 * on the worker's own channel (`worker.postMessage`); the DKT sync protocol
 * uses a dedicated MessagePort so the two never mix.
 */

/** main -> worker, first and only init message; `port` is transferred. */
export type DktWorkerInit = {
	type: "minicut-host:init";
	profileDir: string;
	port: MessagePort;
};

/** main -> worker: close connections and LevelDB, then reply `disposed`. */
export type DktWorkerDisposeMessage = { type: "minicut-host:dispose" };

/** worker -> main: the host is started, LevelDB is open and the port is connected. */
export type DktWorkerReadyMessage = {
	type: "minicut-host:ready";
	identity: NodeProfileIdentity;
};

/** worker -> main: start (or dispose) failed; the host is not usable. */
export type DktWorkerFailedMessage = {
	type: "minicut-host:failed";
	name: string;
	message: string;
	code?: string;
};

export type DktWorkerDisposedMessage = {
	type: "minicut-host:disposed";
	error?: string;
};

export type DktWorkerInbound = DktWorkerInit | DktWorkerDisposeMessage;
export type DktWorkerOutbound =
	| DktWorkerReadyMessage
	| DktWorkerFailedMessage
	| DktWorkerDisposedMessage;
