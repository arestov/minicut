import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MessageChannel, Worker } from "node:worker_threads";
import type { DomSyncPortLike, DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import type { NodeProfileIdentity } from "../../../video-editor/adapters/node/nodeProfileIdentity";
import { createPortTransport } from "../../../video-editor/dkt/shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../../../video-editor/dkt/shared/messageTypes";
import type { DktWorkerInit, DktWorkerOutbound } from "./workerProtocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = path.join(here, "dktWorkerEntry.ts");
const ALIAS_PRELOAD = path.join(
	here,
	"../../../dkt-solid-sync/test/dktAliasPreload.ts",
);

export class DktWorkerStartError extends Error {
	readonly code?: string;
	constructor(name: string, message: string, code?: string) {
		super(message);
		this.name = name;
		this.code = code;
	}
}

export type DktWorkerHandle = {
	/** Page side of the DKT sync port; hand it to `createMiniCutPageSyncRuntime`. */
	transport: DomSyncTransportLike<MiniCutDktTransportMessage>;
	identity: NodeProfileIdentity;
	/**
	 * Idempotent clean shutdown: the worker disposes the runtime and closes
	 * LevelDB, then the worker thread is terminated.
	 */
	dispose(): Promise<void>;
};

export type SpawnDktWorkerOptions = {
	profileDir: string;
	/** Called when the worker dies unexpectedly after a successful start. */
	onCrash?: (error: Error) => void;
};

/**
 * Starts the DKT worker (real MiniCut runtime on LevelDB) and resolves once it
 * reports ready. Bun runs the TypeScript entry directly; its `dkt` alias plugin
 * is a preload that worker threads do not inherit, so it is passed explicitly.
 * Rejects with `DktWorkerStartError` when the host cannot start (profile,
 * LevelDB lock, incomplete effect interfaces).
 */
export const spawnDktWorker = ({
	profileDir,
	onCrash,
}: SpawnDktWorkerOptions): Promise<DktWorkerHandle> =>
	new Promise<DktWorkerHandle>((resolve, reject) => {
		const worker = new Worker(pathToFileURL(WORKER_ENTRY), {
			preload: [ALIAS_PRELOAD],
		} as ConstructorParameters<typeof Worker>[1]);
		const { port1, port2 } = new MessageChannel();
		const transport = createPortTransport<MiniCutDktTransportMessage>(
			port1 as unknown as DomSyncPortLike<MiniCutDktTransportMessage>,
		);
		let settled = false;
		let disposing: Promise<void> | null = null;
		let disposedWaiter: ((error?: string) => void) | null = null;

		const dispose = (): Promise<void> => {
			disposing ||= (async () => {
				const closed = new Promise<string | undefined>((done) => {
					disposedWaiter = done;
					worker.once("exit", () => done(undefined));
				});
				worker.postMessage({ type: "minicut-host:dispose" });
				const error = await closed;
				transport.destroy();
				await worker.terminate();
				if (error) throw new Error(`DKT host dispose failed: ${error}`);
			})();
			return disposing;
		};

		worker.on("message", (message: DktWorkerOutbound) => {
			if (message.type === "minicut-host:ready" && !settled) {
				settled = true;
				resolve({ transport, identity: message.identity, dispose });
				return;
			}
			if (message.type === "minicut-host:failed" && !settled) {
				settled = true;
				transport.destroy();
				void worker.terminate();
				reject(
					new DktWorkerStartError(message.name, message.message, message.code),
				);
				return;
			}
			if (message.type === "minicut-host:disposed") {
				disposedWaiter?.(message.error);
			}
		});
		worker.on("error", (error: Error) => {
			if (!settled) {
				settled = true;
				transport.destroy();
				reject(error);
				return;
			}
			if (!disposing) onCrash?.(error);
		});
		worker.on("exit", (code) => {
			if (!settled) {
				settled = true;
				transport.destroy();
				reject(new Error(`DKT worker exited before start (code ${code})`));
			}
		});

		const init: DktWorkerInit = {
			type: "minicut-host:init",
			profileDir,
			port: port2,
		};
		worker.postMessage(init, [port2]);
	});
