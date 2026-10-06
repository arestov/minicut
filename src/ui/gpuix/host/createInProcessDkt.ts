import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import { createMiniCutDktRuntime } from "../../../video-editor/dkt/runtime/createMiniCutDktRuntime";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import type { MiniCutDktTransportMessage } from "../../../video-editor/dkt/shared/messageTypes";

type Message = MiniCutDktTransportMessage;
type Listener = (message: Message) => void;

/**
 * A pair of in-memory transports implementing the same send/listen/destroy
 * contract as the worker port transport. Messages sent on one side are
 * delivered to the listeners of the other side.
 */
export const createInProcessTransportPair = (): {
	page: DomSyncTransportLike<Message>;
	runtime: DomSyncTransportLike<Message>;
} => {
	const pageListeners = new Set<Listener>();
	const runtimeListeners = new Set<Listener>();

	const side = (
		inbox: Set<Listener>,
		outbox: Set<Listener>,
	): DomSyncTransportLike<Message> => ({
		send(message) {
			for (const listener of [...outbox]) {
				listener(message);
			}
		},
		listen(listener) {
			inbox.add(listener);
			return () => {
				inbox.delete(listener);
			};
		},
		destroy() {
			inbox.clear();
		},
	});

	return {
		page: side(pageListeners, runtimeListeners),
		runtime: side(runtimeListeners, pageListeners),
	};
};

export type InProcessDkt = {
	/** The page sync runtime the Solid binding (`RootScope`) consumes. */
	pageRuntime: PageSyncRuntime;
	destroy(): void;
};

/**
 * Boots the real MiniCut DKT runtime on memory storage inside this process
 * and connects a page sync runtime to it over an in-memory transport.
 * (A worker transport replaces this in stage 5.)
 */
export const createInProcessDkt = (
	options: { sessionKey?: string } = {},
): InProcessDkt => {
	const dktRuntime = createMiniCutDktRuntime({
		enabled: true,
		crdt: { enabled: true, testOnly: true, storage: "memory", transport: null },
	});
	const { page, runtime } = createInProcessTransportPair();
	const connection = dktRuntime.connect(runtime);
	const pageRuntime = createMiniCutPageSyncRuntime({ transport: page });

	pageRuntime.bootstrap({ sessionKey: options.sessionKey ?? "gpuix-fixture" });

	return {
		pageRuntime,
		destroy() {
			pageRuntime.destroy();
			connection.destroy();
		},
	};
};
