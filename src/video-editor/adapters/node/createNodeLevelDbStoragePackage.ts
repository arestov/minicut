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

export class NodeLevelDbStorageOpenError extends Error {
	readonly storagePath: string;

	constructor(storagePath: string, cause: unknown) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		super(`Failed to open MiniCut LevelDB storage at ${storagePath}: ${reason}`, {
			cause,
		});
		this.name = "NodeLevelDbStorageOpenError";
		this.storagePath = storagePath;
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
