import React from "react";
import ReactDOM from "react-dom/client";
import { createVideoEditorHarness } from "../../../app/createVideoEditorHarness";
import { VideoEditorHarnessApp } from "../../../app/VideoEditorHarnessApp";
import type { MiniCutDesktopBridge } from "../shared/ipcChannels";
import { connectDesktopHost } from "./connectDesktopHost";
import { createElectronHarnessPlatform } from "./electronPlatform";

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("missing #root element");
}

const bridge = (window as Window & { minicutDesktop?: MiniCutDesktopBridge })
	.minicutDesktop;
if (!bridge) {
	throw new Error("MiniCut desktop preload bridge is not available");
}

// Room and session ids come from the main process, never from the URL.
const connection = await connectDesktopHost(bridge);
const harness = createVideoEditorHarness(undefined, {
	platform: createElectronHarnessPlatform(connection.port),
});
harness.pageRuntime?.bootstrap({
	sessionKey: connection.sessionKey,
	sessionId: connection.sessionId,
});

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<VideoEditorHarnessApp harness={harness} dktBootstrapOptions={null} />
	</React.StrictMode>,
);

window.addEventListener("pagehide", () => harness.destroy());
