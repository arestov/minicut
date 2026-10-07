/**
 * Names shared by the Electron main process, the preload script and the
 * renderer. Only constants and plain types live here: no Electron or Node
 * imports, so every side can import this file.
 */

export const ELECTRON_IPC = {
	/** renderer -> main (via preload): request a DKT message port. */
	CONNECT: "minicut:connect",
	/** main -> preload: the port plus the window session handshake. */
	PORT: "minicut:port",
} as const;

/** `window.postMessage` channel preload uses to hand the port to the page. */
export const DESKTOP_PORT_MESSAGE_CHANNEL = "minicut:desktop-port";

/** What main tells a window about the session it was mapped to. */
export type DesktopWindowHandshake = {
	/** Room key of the default local workspace (owned by main). */
	sessionKey: string;
	/** UI session of this window. */
	sessionId: string;
};

/** Main's answer to a connect request: session ids, or why there is no channel. */
export type DesktopHandshakeReply =
	| ({ error?: undefined } & DesktopWindowHandshake)
	| { error: string };

/** The reply as delivered to the page, together with the transferred port. */
export type DesktopPortMessage = {
	channel: typeof DESKTOP_PORT_MESSAGE_CHANNEL;
} & DesktopHandshakeReply;

/** API that preload exposes as `window.minicutDesktop`. */
export type MiniCutDesktopBridge = {
	/** Ask main for a message port; the answer arrives via window.postMessage. */
	requestConnection(): void;
};
