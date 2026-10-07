import { createPortAuthorityClient } from "../../../adapters/transport/createPortAuthorityClient";
import { createBrowserHarnessPlatform } from "../../../app/platform";
import type { VideoEditorHarnessPlatform } from "../../../app/platform/types";
import {
	parseAssetUrl,
	type MiniCutDesktopBridge,
} from "../shared/ipcChannels";

export type ElectronHarnessPlatformOptions = {
	port: MessagePort;
	bridge: Pick<MiniCutDesktopBridge, "registerAssetFile" | "releaseAsset">;
};

/**
 * Configuration A platform: the browser platform (export, import, recovery,
 * playback run in this renderer) with
 * - the DKT authority reached over the port handed over by main, and
 * - path-backed files exposed through origin-relative `/asset/<id>` URLs
 *   (HTTP Range, so seek works) instead of blob URLs. Anything without a
 *   local path still gets a normal blob URL.
 */
export const createElectronHarnessPlatform = ({
	port,
	bridge,
}: ElectronHarnessPlatformOptions): VideoEditorHarnessPlatform => {
	const browser = createBrowserHarnessPlatform();
	return {
		...browser,
		createAuthorityClient: () => createPortAuthorityClient(port),
		createObjectUrl(source) {
			if (typeof File !== "undefined" && source instanceof File) {
				const registration = bridge.registerAssetFile(source);
				if (registration.ok) {
					return registration.url;
				}
			}
			return browser.createObjectUrl(source);
		},
		revokeObjectUrl(url) {
			const assetId = parseAssetUrl(url);
			if (assetId) {
				bridge.releaseAsset(assetId);
				return;
			}
			browser.revokeObjectUrl(url);
		},
	};
};
