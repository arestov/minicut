import { MessageChannel, type MessagePort } from "node:worker_threads";
import type { ElectronMainPortLike } from "../../../adapters/transport/electron/createElectronMainPortTransport";

/**
 * `MessagePortMain` look-alike over a Node MessagePort: message events carry
 * `{ data }` like Electron's, not the bare value Node emits.
 */
export const createFakeMainPort = (port: MessagePort): ElectronMainPortLike => {
	const wrapped = new Map<(event: never) => void, (value: unknown) => void>();
	return {
		postMessage: (message) => port.postMessage(message),
		on(event: "message" | "close", listener: (event: never) => void) {
			if (event === "close") {
				port.on("close", listener as () => void);
				return;
			}
			const wrapper = (value: unknown) =>
				(listener as (event: { data: unknown; ports: [] }) => void)({
					data: value,
					ports: [],
				});
			wrapped.set(listener, wrapper);
			port.on("message", wrapper);
		},
		off(event: "message" | "close", listener: (event: never) => void) {
			if (event === "close") {
				port.off("close", listener as () => void);
				return;
			}
			const wrapper = wrapped.get(listener);
			if (wrapper) {
				wrapped.delete(listener);
				port.off("message", wrapper);
			}
		},
		start: () => port.start(),
		close: () => port.close(),
	} as ElectronMainPortLike;
};

export type FakeMessageChannelMain = {
	port1: ElectronMainPortLike;
	/** Renderer end: a plain Node MessagePort (addEventListener/postMessage). */
	port2: MessagePort;
};

export const createFakeMessageChannelMain = (): FakeMessageChannelMain => {
	const channel = new MessageChannel();
	return { port1: createFakeMainPort(channel.port1), port2: channel.port2 };
};
