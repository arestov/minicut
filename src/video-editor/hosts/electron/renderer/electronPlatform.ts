import { createPortAuthorityClient } from "../../../adapters/transport/createPortAuthorityClient";
import { createBrowserHarnessPlatform } from "../../../app/platform";
import type { VideoEditorHarnessPlatform } from "../../../app/platform/types";

export type ElectronHarnessPlatformOptions = {
	port: MessagePort;
};

/**
 * Renderer platform of the Electron window: the browser platform (playback,
 * preview, WebAudio) with the DKT authority reached over the port handed over
 * by main. Import, export and media recovery are not run here: the main
 * process runs them on the Node media service and serves media by asset id.
 */
export const createElectronHarnessPlatform = ({
	port,
}: ElectronHarnessPlatformOptions): VideoEditorHarnessPlatform => ({
	...createBrowserHarnessPlatform(),
	createAuthorityClient: () => createPortAuthorityClient(port),
});
