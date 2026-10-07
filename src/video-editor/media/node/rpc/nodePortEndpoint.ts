import type { MessagePort } from "node:worker_threads";
import type { MediaRpcEndpoint } from "./mediaRpcProtocol";

/** Endpoint over a Node `MessagePort` (workers, tests). */
export const createNodePortEndpoint = <TIn, TOut>(
	port: Pick<MessagePort, "postMessage" | "on" | "off">,
): MediaRpcEndpoint<TIn, TOut> => ({
	post: (message) => port.postMessage(message),
	onMessage(listener) {
		const handler = (message: TIn) => listener(message);
		port.on("message", handler);
		return () => {
			port.off("message", handler);
		};
	},
	onClose(listener) {
		port.on("close", listener);
		return () => {
			port.off("close", listener);
		};
	},
});
