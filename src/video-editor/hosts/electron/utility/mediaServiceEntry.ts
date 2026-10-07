import type {
	MediaRpcClientMessage,
	MediaRpcEndpoint,
	MediaRpcServerMessage,
} from "../../../media/node/rpc/mediaRpcProtocol";
import { runMediaServiceProcess } from "../../../media/node/rpc/runMediaServiceProcess";

/** `process.parentPort` of an Electron utility process. */
type ParentPort = {
	postMessage(message: unknown): void;
	on(event: "message", listener: (event: { data: unknown }) => void): unknown;
	off(event: "message", listener: (event: { data: unknown }) => void): unknown;
};

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
	throw new Error("mediaServiceEntry must run inside an Electron utility process");
}
const port = parentPort;

// The only Electron-specific file of the media service: it adapts the
// parent port to the endpoint the host-neutral service speaks. When the main
// process goes away, the parent port is closed and the process exits.
const endpoint: MediaRpcEndpoint<MediaRpcClientMessage, MediaRpcServerMessage> = {
	post: (message) => port.postMessage(message),
	onMessage(listener) {
		const handler = (event: { data: unknown }) =>
			listener(event.data as MediaRpcClientMessage);
		port.on("message", handler);
		return () => {
			port.off("message", handler);
		};
	},
	onClose: () => () => undefined,
};

void runMediaServiceProcess({ endpoint });
