import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog } from "electron";
import { createBrowserEffectInterfaces } from "../../../adapters/web/createBrowserEffectInterfaces";
import { startDesktopApp, type DesktopApp } from "./desktopApp";

const mainDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(mainDir, "..");

// Tests and tooling point the profile at a throwaway directory.
const userDataOverride = process.env.MINICUT_USER_DATA_DIR;
if (userDataOverride) {
	app.setPath("userData", userDataOverride);
}

let desktopApp: DesktopApp | null = null;
let disposing = false;

const createWindow = async (): Promise<BrowserWindow> => {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		show: false,
		webPreferences: {
			preload: path.join(distRoot, "preload", "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	window.once("ready-to-show", () => window.show());
	const devServerUrl = process.env.MINICUT_RENDERER_URL;
	if (devServerUrl) {
		await window.loadURL(devServerUrl);
	} else {
		await window.loadFile(path.join(distRoot, "renderer", "index.html"));
	}
	return window;
};

const startApp = async (): Promise<void> => {
	try {
		desktopApp = await startDesktopApp({
			profileDir: app.getPath("userData"),
			// Replaced by the configuration A composition (window executors).
			effectInterfaces: createBrowserEffectInterfaces({
				pages: new Set(),
				log: () => undefined,
			}),
		});
	} catch (error) {
		dialog.showErrorBox(
			"MiniCut cannot open the workspace",
			error instanceof Error ? error.message : String(error),
		);
		app.exit(1);
		return;
	}
	await createWindow();
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
