import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import { createPortTransport } from "../../dkt/shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../../dkt/shared/messageTypes";
import type { EditorAuthorityClient } from "../../worker/authorityClient";

/**
 * Authority client over an already connected MessagePort (Electron preload
 * handoff). The page runtime opens exactly one transport; the port is closed
 * when the client is destroyed.
 */
export const createPortAuthorityClient = (
	port: MessagePort,
): EditorAuthorityClient => {
	let transport: DomSyncTransportLike<MiniCutDktTransportMessage> | null = null;
	return {
		openDktTransport() {
			if (transport) {
				throw new Error("Port authority client supports a single DKT transport");
			}
			transport = createPortTransport<MiniCutDktTransportMessage>(port);
			return transport;
		},
		destroy() {
			if (transport) {
				transport.destroy();
				transport = null;
			} else {
				port.close();
			}
		},
	};
};
