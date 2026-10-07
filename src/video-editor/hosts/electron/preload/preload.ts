import { contextBridge, ipcRenderer } from "electron";
import {
	DESKTOP_PORT_MESSAGE_CHANNEL,
	ELECTRON_IPC,
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

const bridge: MiniCutDesktopBridge = {
	requestConnection() {
		ipcRenderer.send(ELECTRON_IPC.CONNECT);
	},
};

contextBridge.exposeInMainWorld("minicutDesktop", bridge);
