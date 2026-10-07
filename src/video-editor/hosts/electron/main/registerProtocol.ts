import type { Protocol } from "electron";
import { MINICUT_PROTOCOL_SCHEME } from "../shared/ipcChannels";

/**
 * Must run before `app.whenReady()`. `stream` and `supportFetchAPI` let
 * media elements and fetch read assets with Range requests; `corsEnabled`
 * and `secure` give the renderer a normal, secure origin.
 */
export const registerMiniCutScheme = (
	protocol: Pick<Protocol, "registerSchemesAsPrivileged">,
): void => {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: MINICUT_PROTOCOL_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				stream: true,
				corsEnabled: true,
			},
		},
	]);
};

export const installMiniCutProtocol = (
	protocol: Pick<Protocol, "handle">,
	handler: (request: Request) => Promise<Response>,
): void => {
	protocol.handle(MINICUT_PROTOCOL_SCHEME, handler);
};
