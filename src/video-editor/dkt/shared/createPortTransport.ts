import type {
	DomSyncPortLike,
	DomSyncTransportLike,
	DomSyncTransportPayloadLike,
} from "dkt/dom-sync/transport.js";

const createListenerSet = <Message>() => {
	const listeners = new Set<(message: Message) => void>();

	return {
		emit(message: Message) {
			for (const listener of listeners) {
				listener(message);
			}
		},
		listen(listener: (message: Message) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};

const extractMessage = <Message>(
	payload: DomSyncTransportPayloadLike<Message>,
): Message =>
	typeof payload === "object" && payload !== null && "data" in payload
		? payload.data
		: (payload as Message);

export const createPortTransport = <Message>(
	port: DomSyncPortLike<Message>,
): DomSyncTransportLike<Message> => {
	if (!port) {
		throw new Error("port is required");
	}

	const listeners = createListenerSet<Message>();
	const onMessage = (payload: DomSyncTransportPayloadLike<Message>) => {
		listeners.emit(extractMessage(payload));
	};

	if (typeof port.addEventListener === "function") {
		port.addEventListener("message", onMessage);
		port.start?.();
	} else if (typeof port.on === "function") {
		port.on("message", onMessage);
		port.start?.();
	} else {
		throw new Error("port endpoint must support addEventListener() or on()");
	}

	return {
		send(message: Message, transferList?: Transferable[]) {
			port.postMessage(message, transferList ?? []);
		},
		listen(listener: (message: Message) => void) {
			return listeners.listen(listener);
		},
		destroy() {
			if (typeof port.removeEventListener === "function") {
				port.removeEventListener("message", onMessage);
			} else if (typeof port.off === "function") {
				port.off("message", onMessage);
			} else {
				port.removeListener?.("message", onMessage);
			}
			port.close?.();
		},
	};
};
