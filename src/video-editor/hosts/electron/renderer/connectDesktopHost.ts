import {
	DESKTOP_PORT_MESSAGE_CHANNEL,
	type DesktopPortMessage,
	type DesktopWindowHandshake,
	type MiniCutDesktopBridge,
} from "../shared/ipcChannels";

export type DesktopHostConnection = DesktopWindowHandshake & {
	port: MessagePort;
};

/**
 * Asks the main process for this window's DKT channel. The listener is
 * installed before the request, so the answer cannot be missed.
 */
export const connectDesktopHost = (
	bridge: Pick<MiniCutDesktopBridge, "requestConnection">,
	target: Window = window,
): Promise<DesktopHostConnection> =>
	new Promise((resolve, reject) => {
		const onMessage = (event: MessageEvent<Partial<DesktopPortMessage>>) => {
			if (
				event.source !== target ||
				event.data?.channel !== DESKTOP_PORT_MESSAGE_CHANNEL
			) {
				return;
			}
			target.removeEventListener("message", onMessage as EventListener);
			const message = event.data as DesktopPortMessage;
			if (message.error !== undefined) {
				reject(new Error(`MiniCut desktop host refused the window: ${message.error}`));
				return;
			}
			const [port] = event.ports;
			if (!port) {
				reject(new Error("MiniCut desktop host sent no message port"));
				return;
			}
			resolve({
				port,
				sessionKey: message.sessionKey,
				sessionId: message.sessionId,
			});
		};
		target.addEventListener("message", onMessage as EventListener);
		bridge.requestConnection();
	});
