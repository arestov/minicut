import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	MessageChannelMain,
	protocol,
	utilityProcess,
} from "electron";
import { MINICUT_APP_URL_PREFIX, MINICUT_RENDERER_ENTRY_URL } from "../shared/ipcChannels";
import {
	resolveExportDir,
	resolveProfileDir,
} from "../../../adapters/node/desktopProfileConfig";
import { startDesktopApp, type DesktopApp } from "./desktopApp";
import { createEditorWindow } from "./editorWindow";
import { registerMiniCutScheme } from "./registerProtocol";
import { describeStartupFailure } from "./startupFailure";

const mainDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(mainDir, "..");

// Privileged schemes must be registered before the app is ready.
registerMiniCutScheme(protocol);

// Chromium's own data (cache, cookies) lives in userData; tests and tooling
// point it at a throwaway directory. The workspace profile is a separate
// folder that the GPUIX app shares (MINICUT_PROFILE_DIR), used in turn.
const userDataOverride = process.env.MINICUT_USER_DATA_DIR;
if (userDataOverride) {
	app.setPath("userData", userDataOverride);
}

// Optional Vite dev server for the renderer (npm run electron:renderer:dev).
const devServerUrl = process.env.MINICUT_RENDERER_URL;

let desktopApp: DesktopApp | null = null;
let disposing = false;

const openWindow = () =>
	createEditorWindow({
		BrowserWindow,
		preloadPath: path.join(distRoot, "preload", "preload.cjs"),
		url: devServerUrl ?? MINICUT_RENDERER_ENTRY_URL,
		allowedUrlPrefixes: [MINICUT_APP_URL_PREFIX, ...(devServerUrl ? [devServerUrl] : [])],
	});

const startApp = async (): Promise<void> => {
	const profileDir = resolveProfileDir();
	try {
		desktopApp = await startDesktopApp({
			profileDir,
			rendererDir: path.join(distRoot, "renderer"),
			mediaServiceEntryPath: path.join(distRoot, "utility", "mediaService.mjs"),
			exportDirectory: resolveExportDir(profileDir),
			electron: { ipcMain, protocol, MessageChannelMain, utilityProcess },
			trustedRendererUrlPrefixes: devServerUrl ? [devServerUrl] : [],
		});
	} catch (error) {
		const failure = describeStartupFailure(error, profileDir);
		console.error("[minicut:electron] startup failed", failure.kind, error);
		dialog.showErrorBox(failure.title, failure.detail);
		app.exit(1);
		return;
	}
	await openWindow();
};

app.on("window-all-closed", () => {
	app.quit();
});

// Quit waits for the host so the LevelDB lock is released and flushed.
app.on("before-quit", (event) => {
	if (disposing || !desktopApp) {
		return;
	}
	event.preventDefault();
	disposing = true;
	void desktopApp
		.dispose()
		.catch((error) => {
			console.error("[minicut:electron] host dispose failed", error);
		})
		.finally(() => {
			desktopApp = null;
			app.quit();
		});
});

void app.whenReady().then(startApp);
