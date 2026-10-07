import { createPortAuthorityClient } from "../../../adapters/transport/createPortAuthorityClient";
import { createBrowserHarnessPlatform } from "../../../app/platform";
import type { VideoEditorHarnessPlatform } from "../../../app/platform/types";

/**
 * Configuration A platform: the browser platform (export, import, recovery,
 * playback run in this renderer) with the DKT authority reached over the
 * port handed over by main instead of a SharedWorker.
 */
export const createElectronHarnessPlatform = (
	port: MessagePort,
): VideoEditorHarnessPlatform => ({
	...createBrowserHarnessPlatform(),
	createAuthorityClient: () => createPortAuthorityClient(port),
});
