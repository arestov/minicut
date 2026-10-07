import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
	DESKTOP_PORT_MESSAGE_CHANNEL,
	ELECTRON_IPC,
	type DesktopAssetRegistration,
	type DesktopHandshakeReply,
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
	requestConnection() {
		ipcRenderer.send(ELECTRON_IPC.CONNECT);
	},
	getPathForFile,
	registerAssetFile(file) {
		const filePath = getPathForFile(file);
		if (!filePath) {
			return { ok: false, reason: "file is not backed by a local path" };
		}
		return ipcRenderer.sendSync(
			ELECTRON_IPC.ASSET_REGISTER,
			filePath,
		) as DesktopAssetRegistration;
	},
	releaseAsset(assetId) {
		ipcRenderer.send(ELECTRON_IPC.ASSET_RELEASE, assetId);
	},
};

contextBridge.exposeInMainWorld("minicutDesktop", bridge);
