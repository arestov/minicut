import type {
	DomSyncPortLike,
	DomSyncTransportLike,
} from "dkt/dom-sync/transport.js";
import { createPortTransport } from "../../../dkt/shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";

/** The part of Electron's `MessagePortMain` this adapter relies on. */
export type ElectronMainPortLike = DomSyncPortLike<MiniCutDktTransportMessage> & {
	on(event: "close", listener: () => void): unknown;
	off(event: "close", listener: () => void): unknown;
};

export type ElectronMainPortTransport =
	DomSyncTransportLike<MiniCutDktTransportMessage> & {
		/** Fires once when the renderer side of the port closes (reload, close, crash). */
		onDisconnect(listener: () => void): () => void;
	};

/**
 * Main-process end of a window's DKT channel: a `MessagePortMain` as a DKT
 * transport. `onDisconnect` lets the runtime clear window-bound state when
 * the renderer goes away.
 */
export const createElectronMainPortTransport = (
	port: ElectronMainPortLike,
): ElectronMainPortTransport => {
	const base = createPortTransport<MiniCutDktTransportMessage>(port);
	const disconnectListeners = new Set<() => void>();
	let closed = false;
	const onClose = () => {
		if (closed) {
			return;
		}
		closed = true;
		for (const listener of [...disconnectListeners]) {
			listener();
		}
	};
	port.on("close", onClose);

	return {
		send: (message, transferList) => {
			if (!closed) {
				base.send(message, transferList);
			}
		},
		listen: (listener) => base.listen(listener),
		onDisconnect(listener) {
			disconnectListeners.add(listener);
			return () => {
				disconnectListeners.delete(listener);
			};
		},
		destroy() {
			closed = true;
			disconnectListeners.clear();
			port.off("close", onClose);
			base.destroy();
		},
	};
};
