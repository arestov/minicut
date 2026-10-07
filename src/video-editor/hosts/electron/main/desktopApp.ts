import type { IpcMain, MessageChannelMain, Protocol } from "electron";
import type { MiniCutEffectInterfaces } from "../../../core/contracts/effectInterfaces";
import {
	startNodeMiniCutHost,
	type NodeMiniCutHost,
} from "../../../adapters/node/startNodeMiniCutHost";
import { MINICUT_APP_URL_PREFIX } from "../shared/ipcChannels";
import { registerAssetIpc } from "./assetIpc";
import {
	createHostAssetRegistry,
	type HostAssetRegistry,
} from "./assetRegistry";
import { createMiniCutProtocolHandler } from "./protocolHandler";
import { installMiniCutProtocol } from "./registerProtocol";
import {
	createWindowConnector,
	type MessageChannelLike,
} from "./windowConnector";

export type DesktopElectronApi = {
	ipcMain: Pick<IpcMain, "on" | "removeListener">;
	protocol: Pick<Protocol, "handle">;
	/** `MessageChannelMain` constructor. */
	MessageChannelMain: typeof MessageChannelMain;
};

export type StartDesktopAppOptions = {
	/** Electron `app.getPath('userData')`; owned by the main process. */
	profileDir: string;
	/** Built renderer served under `minicut://local/app/`. */
	rendererDir: string;
	electron: DesktopElectronApi;
	effectInterfaces: MiniCutEffectInterfaces;
	/** Extra URL prefixes allowed to open channels (a dev server). */
	trustedRendererUrlPrefixes?: readonly string[];
	generateUuid?: () => string;
};

export type DesktopApp = {
	host: NodeMiniCutHost;
	assets: HostAssetRegistry;
	windows: ReturnType<typeof createWindowConnector>;
	/** Idempotent: detaches windows and releases the LevelDB lock. */
	dispose(): Promise<void>;
};

/**
 * Electron main composition: the shared Node host (identity, LevelDB, local
 * CRDT engine without network transport) lives for the lifetime of the app;
 * windows attach to it through the connector, and renderers read assets
 * through the `minicut` protocol. Startup failures are rethrown; they never
 * produce an empty project.
 */
export const startDesktopApp = async ({
	profileDir,
	rendererDir,
	electron,
	effectInterfaces,
	trustedRendererUrlPrefixes = [],
	generateUuid,
}: StartDesktopAppOptions): Promise<DesktopApp> => {
	const host = await startNodeMiniCutHost({
		profileDir,
		effectInterfaces,
		generateUuid,
	});
	const assets = createHostAssetRegistry({ generateId: generateUuid });
	const trustedPrefixes = [MINICUT_APP_URL_PREFIX, ...trustedRendererUrlPrefixes];
	const isTrustedRendererUrl = (url: string): boolean =>
		trustedPrefixes.some((prefix) => url.startsWith(prefix));

	try {
		installMiniCutProtocol(
			electron.protocol,
			createMiniCutProtocolHandler({ assets, rendererDir }),
		);
		const assetIpc = registerAssetIpc({
			assets,
			ipcMain: electron.ipcMain as never,
			isTrustedRendererUrl,
		});
		const windows = createWindowConnector({
			runtime: host.runtime,
			sessionKey: host.identity.roomId,
			// MessagePortMain structurally matches the port the transport needs.
			createMessageChannel: () =>
				new electron.MessageChannelMain() as unknown as MessageChannelLike,
			ipcMain: electron.ipcMain as never,
			isTrustedRendererUrl,
		});
		return {
			host,
			assets,
			windows,
			dispose: async () => {
				windows.dispose();
				assetIpc.dispose();
				await host.dispose();
			},
		};
	} catch (error) {
		await host.dispose().catch(() => undefined);
		throw error;
	}
};
