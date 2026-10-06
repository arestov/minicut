import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
	createMiniCutHarnessWorkspaceId,
	createMiniCutRoomPeerId,
} from "../../dkt/storage/minicutWorkspaceManifest";
import {
	NODE_PROFILE_METADATA_FILE_NAME,
	NODE_PROFILE_METADATA_KIND,
	NODE_PROFILE_METADATA_VERSION,
	NODE_PROFILE_WORKSPACES_DIR_NAME,
	NODE_WORKSPACE_LEVELDB_DIR_NAME,
} from "./nodeProfileLayout";

export type NodeProfileMetadata = {
	kind: typeof NODE_PROFILE_METADATA_KIND;
	profileVersion: number;
	/** Local replica identity (CRDT actor seed); not the room id. */
	localIdentity: string;
	/** Default local workspace key; internal, no UI and no network meaning. */
	roomId: string;
	createdAt: string;
};

export type NodeProfileIdentity = {
	profileDir: string;
	roomId: string;
	workspaceId: string;
	localIdentity: string;
	peerId: string;
	/** LevelDB directory of the default workspace. */
	storagePath: string;
	/** True only for the call that created and persisted the metadata. */
	created: boolean;
};

export type NodeProfileIdentityErrorCode =
	| "metadata_unreadable"
	| "metadata_corrupted"
	| "metadata_unsupported_version"
	| "metadata_missing_with_data"
	| "metadata_write_failed";

export class NodeProfileIdentityError extends Error {
	readonly code: NodeProfileIdentityErrorCode;
	readonly profileDir: string;

	constructor(
		code: NodeProfileIdentityErrorCode,
		profileDir: string,
		message: string,
		cause?: unknown,
	) {
		super(`${message} (profile: ${profileDir})`, cause ? { cause } : undefined);
		this.name = "NodeProfileIdentityError";
		this.code = code;
		this.profileDir = profileDir;
	}
}

export type GetOrCreateNodeProfileIdentityOptions = {
	profileDir: string;
	/** Defaults to `node:crypto.randomUUID`; injectable for tests. */
	generateUuid?: () => string;
	/** Defaults to the current ISO time; injectable for tests. */
	now?: () => string;
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const isErrnoCode = (error: unknown, code: string): boolean =>
	Boolean(error) && (error as { code?: unknown }).code === code;

/** A path that does not exist, or runs through something that is not a directory. */
const isMissingPath = (error: unknown): boolean =>
	isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR");

const isSafeId = (value: unknown): value is string =>
	typeof value === "string" && SAFE_ID_PATTERN.test(value);

const parseMetadata = (raw: string, profileDir: string): NodeProfileMetadata => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new NodeProfileIdentityError(
			"metadata_corrupted",
			profileDir,
			"Profile metadata is not valid JSON",
			error,
		);
	}
	const value = parsed as Partial<NodeProfileMetadata> | null;
	if (
		!value ||
		typeof value !== "object" ||
		value.kind !== NODE_PROFILE_METADATA_KIND ||
		typeof value.profileVersion !== "number" ||
		!Number.isInteger(value.profileVersion)
	) {
		throw new NodeProfileIdentityError(
			"metadata_corrupted",
			profileDir,
			"Profile metadata has an unexpected shape",
		);
	}
	if (value.profileVersion > NODE_PROFILE_METADATA_VERSION) {
		throw new NodeProfileIdentityError(
			"metadata_unsupported_version",
			profileDir,
			`Profile metadata version ${value.profileVersion} is newer than supported ${NODE_PROFILE_METADATA_VERSION}`,
		);
	}
	if (
		value.profileVersion < 1 ||
		!isSafeId(value.localIdentity) ||
		!isSafeId(value.roomId) ||
		typeof value.createdAt !== "string"
	) {
		throw new NodeProfileIdentityError(
			"metadata_corrupted",
			profileDir,
			"Profile metadata is missing required identity fields",
		);
	}
	return value as NodeProfileMetadata;
};

/**
 * Writes `contents` durably to a unique temp file, then publishes it under
 * `filePath` with an exclusive hard link, so concurrent creators never
 * overwrite each other. Returns false when `filePath` already exists.
 */
const publishFileExclusively = async (
	filePath: string,
	contents: string,
): Promise<boolean> => {
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(tempPath, "wx");
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(tempPath, filePath);
		return true;
	} catch (error) {
		if (isErrnoCode(error, "EEXIST")) {
			return false;
		}
		throw error;
	} finally {
		await rm(tempPath, { force: true });
	}
};

const hasWorkspaceData = async (profileDir: string): Promise<boolean> => {
	try {
		const entries = await readdir(
			path.join(profileDir, NODE_PROFILE_WORKSPACES_DIR_NAME),
		);
		return entries.length > 0;
	} catch (error) {
		if (isMissingPath(error)) {
			return false;
		}
		throw error;
	}
};

const toIdentity = (
	profileDir: string,
	metadata: NodeProfileMetadata,
	created: boolean,
): NodeProfileIdentity => {
	const workspaceId = createMiniCutHarnessWorkspaceId(metadata.roomId);
	return {
		profileDir,
		roomId: metadata.roomId,
		workspaceId,
		localIdentity: metadata.localIdentity,
		peerId: createMiniCutRoomPeerId(workspaceId, metadata.localIdentity),
		storagePath: path.join(
			profileDir,
			NODE_PROFILE_WORKSPACES_DIR_NAME,
			metadata.roomId,
			NODE_WORKSPACE_LEVELDB_DIR_NAME,
		),
		created,
	};
};

/**
 * Reads the profile identity, or creates and durably persists it on the first
 * run. Must complete before DKT bootstrap. Unreadable, corrupted, newer or
 * orphaned metadata is a diagnosable error and never creates another
 * workspace.
 */
export const getOrCreateNodeProfileIdentity = async ({
	profileDir,
	generateUuid = randomUUID,
	now = () => new Date().toISOString(),
}: GetOrCreateNodeProfileIdentityOptions): Promise<NodeProfileIdentity> => {
	if (typeof profileDir !== "string" || profileDir.length === 0) {
		throw new Error("MiniCut profileDir should be provided");
	}
	const metadataPath = path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME);

	let raw: string | null = null;
	try {
		raw = await readFile(metadataPath, "utf8");
	} catch (error) {
		if (!isMissingPath(error)) {
			throw new NodeProfileIdentityError(
				"metadata_unreadable",
				profileDir,
				"Profile metadata could not be read",
				error,
			);
		}
	}
	if (raw !== null) {
		return toIdentity(profileDir, parseMetadata(raw, profileDir), false);
	}

	let orphaned: boolean;
	try {
		orphaned = await hasWorkspaceData(profileDir);
	} catch (error) {
		throw new NodeProfileIdentityError(
			"metadata_unreadable",
			profileDir,
			"Profile directory could not be inspected",
			error,
		);
	}
	if (orphaned) {
		throw new NodeProfileIdentityError(
			"metadata_missing_with_data",
			profileDir,
			"Profile metadata is missing but workspace data exists; refusing to create a new workspace",
		);
	}

	const metadata: NodeProfileMetadata = {
		kind: NODE_PROFILE_METADATA_KIND,
		profileVersion: NODE_PROFILE_METADATA_VERSION,
		localIdentity: generateUuid(),
		roomId: generateUuid(),
		createdAt: now(),
	};
	if (!isSafeId(metadata.localIdentity) || !isSafeId(metadata.roomId)) {
		throw new Error("MiniCut identity generator returned an unsafe id");
	}
	let published: boolean;
	try {
		await mkdir(profileDir, { recursive: true });
		published = await publishFileExclusively(
			metadataPath,
			`${JSON.stringify(metadata, null, 2)}\n`,
		);
	} catch (error) {
		throw new NodeProfileIdentityError(
			"metadata_write_failed",
			profileDir,
			"Profile metadata could not be written",
			error,
		);
	}
	if (!published) {
		// Another creator won the race: use the ids it persisted.
		let winnerRaw: string;
		try {
			winnerRaw = await readFile(metadataPath, "utf8");
		} catch (error) {
			throw new NodeProfileIdentityError(
				"metadata_unreadable",
				profileDir,
				"Profile metadata could not be read",
				error,
			);
		}
		return toIdentity(profileDir, parseMetadata(winnerRaw, profileDir), false);
	}
	return toIdentity(profileDir, metadata, true);
};
