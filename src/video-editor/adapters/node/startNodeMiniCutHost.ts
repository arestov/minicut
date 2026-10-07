import { assertEffectInterfacesComplete } from "../../core/bootstrap/assertEffectInterfaces";
import type { MiniCutEffectInterfaces } from "../../core/contracts/effectInterfaces";
import { createMiniCutDktRuntime } from "../../dkt/runtime/createMiniCutDktRuntime";
import { createNodeLevelDbStoragePackage } from "./createNodeLevelDbStoragePackage";
import {
	getOrCreateNodeProfileIdentity,
	type NodeProfileIdentity,
} from "./nodeProfileIdentity";

/** Session key used for the workspace open policy of the local runtime. */
export const NODE_HOST_SESSION_KEY = "minicut-node-host";

export type StartNodeMiniCutHostOptions = {
	profileDir: string;
	/** Injected effect implementations; completeness is checked at startup. */
	effectInterfaces: MiniCutEffectInterfaces;
	generateUuid?: () => string;
	/** Storage opener; defaults to the LevelDB factory. Injectable for tests. */
	openStorage?: typeof createNodeLevelDbStoragePackage;
};

export type NodeMiniCutHost = {
	identity: NodeProfileIdentity;
	/** Connect UI windows here; all of them share this one runtime and actor. */
	runtime: ReturnType<typeof createMiniCutDktRuntime>;
	/** Idempotent: closes connections, flushes and closes LevelDB. */
	dispose(): Promise<void>;
};

/**
 * Node host composition: persisted identity, full LevelDB storage package,
 * local CRDT engine with the saved peerId and no network transport.
 * Order: identity (persisted) -> storage -> prepare -> start/reinit.
 * Any failure closes what was opened and is rethrown; it never produces an
 * empty project.
 */
export const startNodeMiniCutHost = async ({
	profileDir,
	effectInterfaces,
	generateUuid,
	openStorage = createNodeLevelDbStoragePackage,
}: StartNodeMiniCutHostOptions): Promise<NodeMiniCutHost> => {
	// Fail before any I/O: no identity is persisted and no database is opened
	// for a host that cannot run.
	assertEffectInterfacesComplete(effectInterfaces);
	const identity = await getOrCreateNodeProfileIdentity({
		profileDir,
		generateUuid,
	});
	const storagePackage = await openStorage({
		storagePath: identity.storagePath,
	});
	let disposePromise: Promise<void> | null = null;
	let runtime: ReturnType<typeof createMiniCutDktRuntime> | null = null;
	const dispose = (): Promise<void> => {
		disposePromise ||= (async () => {
			let firstError: unknown = null;
			let failed = false;
			try {
				await runtime?.dispose();
			} catch (error) {
				failed = true;
				firstError = error;
			}
			try {
				await storagePackage.close?.();
			} catch (error) {
				if (!failed) {
					failed = true;
					firstError = error;
				}
			}
			if (failed) {
				// Allow a retry; the database lock is released by close() above
				// unless close itself failed.
				disposePromise = null;
				throw firstError;
			}
		})();
		return disposePromise;
	};

	try {
		runtime = createMiniCutDktRuntime({
			enabled: true,
			effectInterfaces,
			keepStorageOpenOnDisconnect: true,
			crdt: {
				enabled: true,
				peerId: identity.peerId,
				storage: storagePackage,
				transport: null,
				workspaceIdForSessionKey: () => identity.workspaceId,
			},
		});
		await runtime.start(NODE_HOST_SESSION_KEY);
	} catch (error) {
		// A failed start owns the writes it staged (e.g. the first workspace
		// manifest): drop them so close() does not persist a workspace that
		// never started.
		storagePackage.discard?.();
		await dispose().catch(() => undefined);
		throw error;
	}
	return { identity, runtime, dispose };
};
