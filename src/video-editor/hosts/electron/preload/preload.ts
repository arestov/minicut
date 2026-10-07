import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
	DESKTOP_PORT_MESSAGE_CHANNEL,
	ELECTRON_IPC,
	type DesktopHandshakeReply,
	type DesktopImportStaging,
	type DesktopPortMessage,
	type MiniCutDesktopBridge,
} from "../shared/ipcChannels";

// A MessagePort cannot cross contextBridge, so the port goes to the page
// through window.postMessage; the page asks for it explicitly after it has
// installed its listener.
ipcRenderer.on(ELECTRON_IPC.PORT, (event, message: DesktopHandshakeReply) => {
	const payload: DesktopPortMessage = {
		...message,
		channel: DESKTOP_PORT_MESSAGE_CHANNEL,
	};
	window.postMessage(payload, "*", [...event.ports]);
});

const getPathForFile = (file: File): string => {
	try {
		return webUtils.getPathForFile(file);
	} catch {
		return "";
	}
};

const bridge: MiniCutDesktopBridge = {
	stageImportFiles(files) {
		const paths = files.map((file) => getPathForFile(file));
		if (paths.length === 0 || paths.some((filePath) => !filePath)) {
			return { ok: false, reason: "a file is not backed by a local path" };
		}
		return ipcRenderer.sendSync(ELECTRON_IPC.IMPORT_STAGE, paths) as DesktopImportStaging;
	},
	requestConnection() {
		ipcRenderer.send(ELECTRON_IPC.CONNECT);
	},
	getPathForFile,
};

contextBridge.exposeInMainWorld("minicutDesktop", bridge);
