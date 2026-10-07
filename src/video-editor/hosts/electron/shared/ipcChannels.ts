/**
 * Names shared by the Electron main process, the preload script and the
 * renderer. Only constants and plain types live here: no Electron or Node
 * imports, so every side can import this file.
 */

/** Custom scheme that serves the renderer bundle and registered assets. */
export const MINICUT_PROTOCOL_SCHEME = "minicut";
/** One host for the app and its assets, so media elements stay same-origin. */
export const MINICUT_PROTOCOL_HOST = "local";
export const MINICUT_APP_URL_PREFIX = `${MINICUT_PROTOCOL_SCHEME}://${MINICUT_PROTOCOL_HOST}/app/`;
export const MINICUT_ASSET_URL_PREFIX = `${MINICUT_PROTOCOL_SCHEME}://${MINICUT_PROTOCOL_HOST}/asset/`;
export const MINICUT_RENDERER_ENTRY_URL = `${MINICUT_APP_URL_PREFIX}index.html`;

/** Origin-relative path of an asset: `/asset/<id>`. */
export const MINICUT_ASSET_PATH_PREFIX = "/asset/";

/**
 * Asset URL as the renderer uses it. It is origin-relative on purpose: the
 * shared editor UI only treats blob:, data:, http and relative URLs as real
 * media, and a relative URL resolves against the minicut origin the page
 * itself was loaded from.
 */
export const createAssetUrl = (assetId: string): string =>
	`${MINICUT_ASSET_PATH_PREFIX}${encodeURIComponent(assetId)}`;

/** Asset id of `/asset/<id>` or `minicut://local/asset/<id>`, or null for any other URL. */
export const parseAssetUrl = (url: string): string | null => {
	const path = url.startsWith(MINICUT_ASSET_URL_PREFIX)
		? url.slice(MINICUT_ASSET_URL_PREFIX.length - MINICUT_ASSET_PATH_PREFIX.length)
		: url;
	if (!path.startsWith(MINICUT_ASSET_PATH_PREFIX)) {
		return null;
	}
	const id = path.slice(MINICUT_ASSET_PATH_PREFIX.length);
	if (!id || id.includes("/")) {
		return null;
	}
	try {
		return decodeURIComponent(id);
	} catch {
		return null;
	}
};

export const ELECTRON_IPC = {
	/** renderer -> main (via preload): request a DKT message port. */
	CONNECT: "minicut:connect",
	/** main -> preload: the port plus the window session handshake. */
	PORT: "minicut:port",
	/** renderer -> main, synchronous: register a local file as an asset. */
	ASSET_REGISTER: "minicut:asset:register",
	/** renderer -> main: release a registered asset. */
	ASSET_RELEASE: "minicut:asset:release",
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

export type DesktopAssetRegistration =
	| { ok: true; assetId: string; url: string; name: string; size: number }
	| { ok: false; reason: string };

/** API that preload exposes as `window.minicutDesktop`. */
export type MiniCutDesktopBridge = {
	/** Ask main for a message port; the answer arrives via window.postMessage. */
	requestConnection(): void;
	/** Local path of a dropped or picked file; empty when it is not path-backed. */
	getPathForFile(file: File): string;
	/**
	 * Registers a path-backed file with the host asset registry. Files never
	 * cross IPC: main reads the path itself and serves it by asset id.
	 */
	registerAssetFile(file: File): DesktopAssetRegistration;
	releaseAsset(assetId: string): void;
};
