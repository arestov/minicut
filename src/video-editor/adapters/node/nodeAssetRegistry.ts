import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	AssetLocation,
	AssetResolution,
	AssetResolver,
} from "../../media/contracts/assets";

/**
 * Host asset registry for local files (Node/GPUIX/Electron main). The graph
 * stores only the asset id; the absolute path lives here, per workspace, in a
 * JSON file next to the workspace LevelDB. `File`, paths and handles never
 * enter DKT.
 *
 * It also implements the media service `AssetResolver`, so export/probe/proxy
 * jobs resolve asset ids through it.
 */
import { NODE_WORKSPACE_ASSET_REGISTRY_FILE_NAME } from "./nodeProfileLayout";

/** Registry file of the workspace whose LevelDB lives at `storagePath`. */
export const nodeAssetRegistryPathFor = (storagePath: string): string =>
	path.join(path.dirname(storagePath), NODE_WORKSPACE_ASSET_REGISTRY_FILE_NAME);

export const NODE_ASSET_REGISTRY_KIND = "minicut-asset-registry";
export const NODE_ASSET_REGISTRY_VERSION = 1;

export type NodeAssetRecord = {
	assetId: string;
	/** Absolute path on the host filesystem. */
	path: string;
};

type RegistryFile = {
	kind: typeof NODE_ASSET_REGISTRY_KIND;
	version: number;
	assets: NodeAssetRecord[];
};

export class NodeAssetRegistryError extends Error {
	readonly code:
		| "registry_unreadable"
		| "registry_corrupted"
		| "registry_unsupported_version"
		| "registry_write_failed"
		| "invalid_path"
		| "unknown_asset";

	constructor(
		code: NodeAssetRegistryError["code"],
		message: string,
		cause?: unknown,
	) {
		super(message, cause ? { cause } : undefined);
		this.name = "NodeAssetRegistryError";
		this.code = code;
	}
}

export type NodeAssetRegistry = AssetResolver & {
	/**
	 * Registers a file. The same normalised path always yields the same asset
	 * id, so importing a file twice does not fork its identity.
	 */
	register(filePath: string): Promise<NodeAssetRecord>;
	get(assetId: string): NodeAssetRecord | null;
	/** Points an existing asset id at another file (relink). */
	relink(assetId: string, filePath: string): Promise<NodeAssetRecord>;
	list(): readonly NodeAssetRecord[];
	/** Resolves when every accepted change has reached the file. */
	flush(): Promise<void>;
	resolve(assetId: string): Promise<AssetResolution>;
};

export type CreateNodeAssetRegistryOptions = {
	/** Registry JSON file; its directory is created on the first write. */
	filePath: string;
	/** Asset id source; injectable for tests. */
	generateId?: () => string;
};

const pathKey = (filePath: string): string =>
	process.platform === "win32" ? filePath.toLowerCase() : filePath;

const normalizePath = (filePath: string): string => {
	if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
		throw new NodeAssetRegistryError(
			"invalid_path",
			`Asset path must be absolute: ${String(filePath)}`,
		);
	}
	return path.resolve(filePath);
};

const parseRegistry = (raw: string, filePath: string): NodeAssetRecord[] => {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new NodeAssetRegistryError(
			"registry_corrupted",
			`Asset registry is not valid JSON: ${filePath}`,
			error,
		);
	}
	const file = value as Partial<RegistryFile> | null;
	if (
		!file ||
		file.kind !== NODE_ASSET_REGISTRY_KIND ||
		!Array.isArray(file.assets)
	) {
		throw new NodeAssetRegistryError(
			"registry_corrupted",
			`Asset registry has an unexpected shape: ${filePath}`,
		);
	}
	if (
		typeof file.version !== "number" ||
		file.version > NODE_ASSET_REGISTRY_VERSION
	) {
		throw new NodeAssetRegistryError(
			"registry_unsupported_version",
			`Asset registry version ${String(file.version)} is newer than this build supports: ${filePath}`,
		);
	}
	return file.assets.map((entry) => {
		const record = entry as Partial<NodeAssetRecord> | null;
		if (
			!record ||
			typeof record.assetId !== "string" ||
			!record.assetId ||
			typeof record.path !== "string" ||
			!path.isAbsolute(record.path)
		) {
			throw new NodeAssetRegistryError(
				"registry_corrupted",
				`Asset registry has an invalid entry: ${filePath}`,
			);
		}
		return { assetId: record.assetId, path: record.path };
	});
};

/**
 * Opens (or starts empty) the registry at `filePath`. A missing file is an
 * empty registry; an unreadable or corrupt file is an error and is never
 * replaced silently, so asset ids of an existing workspace are not lost.
 */
export const createNodeAssetRegistry = async ({
	filePath,
	generateId = () => `asset_${randomUUID()}`,
}: CreateNodeAssetRegistryOptions): Promise<NodeAssetRegistry> => {
	const byId = new Map<string, NodeAssetRecord>();
	const idByPath = new Map<string, string>();

	let raw: string | null = null;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw new NodeAssetRegistryError(
				"registry_unreadable",
				`Cannot read asset registry: ${filePath}`,
				error,
			);
		}
	}
	if (raw !== null) {
		for (const record of parseRegistry(raw, filePath)) {
			byId.set(record.assetId, record);
			idByPath.set(pathKey(record.path), record.assetId);
		}
	}

	let writeChain: Promise<void> = Promise.resolve();
	let writeSequence = 0;
	const persist = (): Promise<void> => {
		const snapshot: RegistryFile = {
			kind: NODE_ASSET_REGISTRY_KIND,
			version: NODE_ASSET_REGISTRY_VERSION,
			assets: [...byId.values()],
		};
		const temp = `${filePath}.${++writeSequence}.tmp`;
		const write = writeChain.then(async () => {
			try {
				await mkdir(path.dirname(filePath), { recursive: true });
				await writeFile(
					temp,
					`${JSON.stringify(snapshot, null, "\t")}\n`,
					"utf8",
				);
				await rename(temp, filePath);
			} catch (error) {
				await rm(temp, { force: true }).catch(() => undefined);
				throw new NodeAssetRegistryError(
					"registry_write_failed",
					`Cannot write asset registry: ${filePath}`,
					error,
				);
			}
		});
		// A failed write must not poison later writes; its own caller sees the error.
		writeChain = write.catch(() => undefined);
		return write;
	};

	return {
		async register(inputPath) {
			const resolved = normalizePath(inputPath);
			const existingId = idByPath.get(pathKey(resolved));
			const existing = existingId ? byId.get(existingId) : undefined;
			if (existing) return existing;
			const record: NodeAssetRecord = { assetId: generateId(), path: resolved };
			byId.set(record.assetId, record);
			idByPath.set(pathKey(resolved), record.assetId);
			await persist();
			return record;
		},
		get: (assetId) => byId.get(assetId) ?? null,
		async relink(assetId, inputPath) {
			const current = byId.get(assetId);
			if (!current) {
				throw new NodeAssetRegistryError(
					"unknown_asset",
					`Unknown asset id: ${assetId}`,
				);
			}
			const resolved = normalizePath(inputPath);
			idByPath.delete(pathKey(current.path));
			const next: NodeAssetRecord = { assetId, path: resolved };
			byId.set(assetId, next);
			idByPath.set(pathKey(resolved), assetId);
			await persist();
			return next;
		},
		list: () => [...byId.values()],
		flush: () => writeChain,
		async resolve(assetId): Promise<AssetResolution> {
			const record = byId.get(assetId);
			if (!record) {
				return {
					ok: false,
					error: {
						code: "asset-not-found",
						message: `Unknown asset id: ${assetId}`,
						details: { assetId },
					},
				};
			}
			try {
				const info = await stat(record.path);
				if (!info.isFile()) throw new Error("not a file");
			} catch (error) {
				const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
				return {
					ok: false,
					error: {
						code: missing ? "asset-not-found" : "asset-unreadable",
						message: missing
							? `Asset file is missing: ${record.path}`
							: `Asset file is not readable: ${record.path}`,
						details: { assetId, path: record.path },
					},
				};
			}
			const location: AssetLocation = { path: record.path };
			return { ok: true, location };
		},
	};
};
