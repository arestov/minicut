import type { BrowserWindow as BrowserWindowType } from "electron";
import { MINICUT_APP_URL_PREFIX } from "../shared/ipcChannels";
import { isUrlUnderPrefix } from "./windowConnector";

export type CreateEditorWindowOptions = {
	BrowserWindow: typeof BrowserWindowType;
	preloadPath: string;
	url: string;
	/** Tests open windows hidden. */
	show?: boolean;
	/** Tests keep timers of hidden windows running. Defaults to Electron behaviour. */
	backgroundThrottling?: boolean;
	/** The window may only be at these URLs (a dev server is added by the app). */
	allowedUrlPrefixes?: readonly string[];
};

/**
 * Opens one editor window; every window gets the same sandboxed preload.
 * New windows are always denied and navigation away from the allowed URLs
 * is blocked, so a link or script cannot turn the window into a page that
 * holds the preload bridge.
 */
export const createEditorWindow = async ({
	BrowserWindow,
	preloadPath,
	url,
	show = true,
	backgroundThrottling,
	allowedUrlPrefixes = [MINICUT_APP_URL_PREFIX],
}: CreateEditorWindowOptions): Promise<BrowserWindowType> => {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		show: false,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			...(backgroundThrottling === undefined ? null : { backgroundThrottling }),
		},
	});
	const isAllowed = (target: string): boolean =>
		allowedUrlPrefixes.some((prefix) => isUrlUnderPrefix(target, prefix));
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (details) => {
		if (!isAllowed(details.url)) {
			details.preventDefault();
		}
	});
	window.webContents.on("will-redirect", (details) => {
		if (!isAllowed(details.url)) {
			details.preventDefault();
		}
	});
	if (show) {
		window.once("ready-to-show", () => window.show());
	}
	await window.loadURL(url);
	return window;
};
