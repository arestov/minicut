import { createPortAuthorityClient } from "../../../adapters/transport/createPortAuthorityClient";
import { createBrowserHarnessPlatform } from "../../../app/platform";
import type { VideoEditorHarnessPlatform } from "../../../app/platform/types";
import type { MiniCutDesktopBridge } from "../shared/ipcChannels";

export type ElectronHarnessPlatformOptions = {
	port: MessagePort;
	bridge: Pick<MiniCutDesktopBridge, "stageImportFiles">;
};

/**
 * Renderer platform of the Electron window: the browser platform (playback,
 * preview, WebAudio) with the DKT authority reached over the port handed over
 * by main. Import, export and media recovery are not run here: the main
 * process runs them on the Node media service and serves media by asset id;
 * picked files reach it as local paths (`stageHostImport`).
 */
export const createElectronHarnessPlatform = ({
	port,
	bridge,
}: ElectronHarnessPlatformOptions): VideoEditorHarnessPlatform => ({
	...createBrowserHarnessPlatform(),
	createAuthorityClient: () => createPortAuthorityClient(port),
	stageHostImport(files) {
		const staging = bridge.stageImportFiles(files);
		return staging.ok ? staging.batchId : null;
	},
});

/**
 * The File System Access picker returns handles the host cannot use: media
 * lives in the host asset registry by local path. Without the picker the
 * import control falls back to the native file input, whose files carry
 * their local path (`webUtils.getPathForFile`).
 */
export const disableFileSystemAccessPicker = (target: object = window): void => {
	Reflect.deleteProperty(target, "showOpenFilePicker");
	Reflect.deleteProperty(target, "showSaveFilePicker");
	Reflect.deleteProperty(target, "showDirectoryPicker");
};
