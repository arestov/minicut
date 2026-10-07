import type { IpcMain, MessageChannelMain, Protocol } from "electron";
import type { MiniCutEffectInterfaces } from "../../../core/contracts/effectInterfaces";
import {
	startNodeMiniCutHost,
	type NodeMiniCutHost,
} from "../../../adapters/node/startNodeMiniCutHost";
import { MINICUT_APP_URL_PREFIX } from "../shared/ipcChannels";
import { createWindowExecutorEffectInterfaces } from "./createWindowExecutorEffectInterfaces";
import {
	createNodeAssetRegistry,
	nodeAssetRegistryPathFor,
	type NodeAssetRegistry,
} from "../../../adapters/node/nodeAssetRegistry";
import {
	createMiniCutProtocolHandler,
	createRegistryAssetSource,
} from "./protocolHandler";
import { installMiniCutProtocol } from "./registerProtocol";
import {
	createWindowConnector,
	isUrlUnderPrefix,
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
	/** Defaults to configuration A: browser executors in the renderer windows. */
	effectInterfaces?: MiniCutEffectInterfaces;
	/** Extra URL prefixes allowed to open channels (a dev server). */
	trustedRendererUrlPrefixes?: readonly string[];
	generateUuid?: () => string;
};

export type DesktopApp = {
	host: NodeMiniCutHost;
	/** Persistent registry of the workspace (asset id -> local file); the protocol serves from it. */
	assets: NodeAssetRegistry;
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
	effectInterfaces: effectInterfacesOverride,
	trustedRendererUrlPrefixes = [],
	generateUuid,
}: StartDesktopAppOptions): Promise<DesktopApp> => {
	// The effect interfaces are needed before the runtime exists, the window
	// connector after it: windows are resolved lazily.
	let windows: ReturnType<typeof createWindowConnector> | null = null;
	const effectInterfaces =
		effectInterfacesOverride ??
		createWindowExecutorEffectInterfaces({
			getWindows: () => windows?.getConnectedWindows() ?? [],
			claimImportWindow: (handleId) => windows?.claimImportWindow(handleId) ?? null,
			onDropped: (type, reason) =>
				console.warn("[minicut:electron] effect dropped", type, reason),
		});
	const host = await startNodeMiniCutHost({
		profileDir,
		effectInterfaces,
		generateUuid,
	});
	let assets: NodeAssetRegistry;
	try {
		assets = await createNodeAssetRegistry({
			filePath: nodeAssetRegistryPathFor(host.identity.storagePath),
			generateId: generateUuid,
		});
	} catch (error) {
		await host.dispose().catch(() => undefined);
		throw error;
	}
	const trustedPrefixes = [MINICUT_APP_URL_PREFIX, ...trustedRendererUrlPrefixes];
	const isTrustedRendererUrl = (url: string): boolean =>
		trustedPrefixes.some((prefix) => isUrlUnderPrefix(url, prefix));

	try {
		installMiniCutProtocol(
			electron.protocol,
			createMiniCutProtocolHandler({
				assets: createRegistryAssetSource(assets),
				rendererDir,
			}),
		);
		const connector = createWindowConnector({
			runtime: host.runtime,
			sessionKey: host.identity.roomId,
			// MessagePortMain structurally matches the port the transport needs.
			createMessageChannel: () =>
				new electron.MessageChannelMain() as unknown as MessageChannelLike,
			ipcMain: electron.ipcMain as never,
			isTrustedRendererUrl,
		});
		windows = connector;
		return {
			host,
			assets,
			windows: connector,
			dispose: async () => {
				connector.dispose();
				await assets.flush().catch(() => undefined);
				await host.dispose();
			},
		};
	} catch (error) {
		await assets.flush().catch(() => undefined);
		await host.dispose().catch(() => undefined);
		throw error;
	}
};
