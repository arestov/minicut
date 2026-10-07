import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const mainDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(mainDir, "..");

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

app.on("window-all-closed", () => {
	app.quit();
});

void app.whenReady().then(createWindow);
