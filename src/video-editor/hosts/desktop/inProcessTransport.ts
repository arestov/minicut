import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import type { MiniCutDktTransportMessage } from "../../dkt/shared/messageTypes";

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
