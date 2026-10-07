import type { MiniCutEffectInterfaces } from "../../../core/contracts/effectInterfaces";
import {
	startNodeMiniCutHost,
	type NodeMiniCutHost,
} from "../../../adapters/node/startNodeMiniCutHost";

export type StartDesktopAppOptions = {
	/** Electron `app.getPath('userData')`; owned by the main process. */
	profileDir: string;
	effectInterfaces: MiniCutEffectInterfaces;
	generateUuid?: () => string;
};

export type DesktopApp = {
	host: NodeMiniCutHost;
	/** Idempotent: releases the LevelDB lock. */
	dispose(): Promise<void>;
};

/**
 * Electron main composition: the shared Node host (identity, LevelDB, local
 * CRDT engine without network transport) lives for the lifetime of the app.
 * Startup failures are rethrown; they never produce an empty project.
 */
export const startDesktopApp = async ({
	profileDir,
	effectInterfaces,
	generateUuid,
}: StartDesktopAppOptions): Promise<DesktopApp> => {
	const host = await startNodeMiniCutHost({
		profileDir,
		effectInterfaces,
		generateUuid,
	});
	return {
		host,
		dispose: () => host.dispose(),
	};
};
