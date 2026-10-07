import { EventEmitter } from "node:events";
import type {
	MediaRpcClientMessage,
	MediaRpcServerMessage,
} from "../../../media/node/rpc/mediaRpcProtocol";
import { runMediaServiceProcess } from "../../../media/node/rpc/runMediaServiceProcess";
import type { UtilityProcessApi, UtilityProcessLike } from "../main/mediaServiceProcess";

export type FakeUtilityProcess = {
	api: UtilityProcessApi;
	/** Number of processes forked and not yet ended. */
	running(): number;
};

/**
 * `utilityProcess` look-alike that runs the real media service (real ffmpeg)
 * in this process behind the same message protocol. The service starts after
 * `fork` returned, like a real process, and a kill ends it asynchronously.
 */
export const createFakeUtilityProcess = (
	options: { binaries?: { ffmpegPath?: string; ffprobePath?: string } } = {},
): FakeUtilityProcess => {
	let running = 0;
	const api: UtilityProcessApi = {
		fork() {
			const toChild = new EventEmitter();
			const child = new EventEmitter();
			let ended = false;
			let dispose: (() => void) | null = null;
			const end = (code: number) => {
				if (ended) return;
				ended = true;
				running -= 1;
				dispose?.();
				child.emit("exit", code);
			};
			running += 1;
			const fake: UtilityProcessLike = {
				postMessage: (message) => {
					if (!ended) toChild.emit("message", message);
				},
				on: ((event: string, listener: (...args: never[]) => void) => {
					child.on(event, listener as (...args: unknown[]) => void);
				}) as UtilityProcessLike["on"],
				kill: () => {
					setImmediate(() => end(0));
					return true;
				},
			};
			setImmediate(() => {
				if (ended) return;
				void runMediaServiceProcess({
					binaries: options.binaries,
					endpoint: {
						post: (message: MediaRpcServerMessage) => {
							if (!ended) child.emit("message", message);
						},
						onMessage: (listener: (message: MediaRpcClientMessage) => void) => {
							toChild.on("message", listener);
							return () => {
								toChild.off("message", listener);
							};
						},
						onClose: () => () => undefined,
					},
				}).then((server) => {
					dispose = () => server?.dispose();
				});
			});
			return fake;
		},
	};
	return { api, running: () => running };
};
