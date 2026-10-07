import { ClassicLevel } from "classic-level";
import { makeDktCrdtLevelDBStorage } from "dkt/crdt/storage/leveldb.js";
import type { MiniCutCrdtStoragePackage } from "../../dkt/runtime/createMiniCutDktRuntime";

export type NodeLevelDbStorageLevelClass = new (
	location: string,
	options: { valueEncoding: "buffer" },
) => unknown;

export type CreateNodeLevelDbStoragePackageOptions = {
	/** Absolute directory of the LevelDB database owned by this process. */
	storagePath: string;
	/** Override for tests; defaults to `classic-level`. */
	Level?: NodeLevelDbStorageLevelClass;
};

/** True when some error in the cause chain is LevelDB's `LEVEL_LOCKED`: another process owns the database. */
export const isLevelDbLockedError = (error: unknown): boolean => {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		if ((current as { code?: unknown }).code === "LEVEL_LOCKED") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
};

export class NodeLevelDbStorageOpenError extends Error {
	readonly storagePath: string;
	/** Another process (a second MiniCut app on this profile) holds the database. */
	readonly locked: boolean;

	constructor(storagePath: string, cause: unknown) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		super(`Failed to open MiniCut LevelDB storage at ${storagePath}: ${reason}`, {
			cause,
		});
		this.name = "NodeLevelDbStorageOpenError";
		this.storagePath = storagePath;
		this.locked = isLevelDbLockedError(cause);
	}
}

/**
 * Opens (or creates) a full DKT CRDT storage package on LevelDB:
 * `dktStorage`, `crdtStorage`, `commitChanges`, `whenReady`, `close`.
 * The caller (host) owns the package and must close it; one process owns a
 * database at a time, a second open fails with `NodeLevelDbStorageOpenError`.
 */
export const createNodeLevelDbStoragePackage = async ({
	storagePath,
	Level = ClassicLevel as unknown as NodeLevelDbStorageLevelClass,
}: CreateNodeLevelDbStoragePackageOptions): Promise<MiniCutCrdtStoragePackage> => {
	if (typeof storagePath !== "string" || storagePath.length === 0) {
		throw new Error("MiniCut LevelDB storagePath should be provided");
	}
	try {
		const storagePackage = (await makeDktCrdtLevelDBStorage({
			storagePath,
			Level,
		})) as MiniCutCrdtStoragePackage;
		return storagePackage;
	} catch (error) {
		throw new NodeLevelDbStorageOpenError(storagePath, error);
	}
};
