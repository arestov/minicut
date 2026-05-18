import {
	adoptLegacyDktStorageV0,
	inspectDktStorageForOpen,
} from "dkt-all/libs/provoda/crdt/storage/atomic/dktStorageOpenPolicy.js";

export const MINICUT_APP_ID = "minicut";
export const MINICUT_APP_SCHEMA_VERSION = 1;
export const MINICUT_DERIVED_SCHEMA_VERSION = 1;
export const MINICUT_DKT_STORAGE_VERSION = 1;
export const MINICUT_SCHEMA_DICTIONARY_MODE = "none";

export type MiniCutWorkspaceManifest = {
	kind: "dkt-workspace";
	manifestVersion: 1;
	workspaceId: string;
	appId: typeof MINICUT_APP_ID;
	dktStorageVersion: typeof MINICUT_DKT_STORAGE_VERSION;
	appSchemaVersion: typeof MINICUT_APP_SCHEMA_VERSION;
	derivedSchemaVersion: typeof MINICUT_DERIVED_SCHEMA_VERSION;
	schemaDictionaryMode: typeof MINICUT_SCHEMA_DICTIONARY_MODE;
};

export type MiniCutWorkspaceOpenStatus = "empty" | "ready" | "adopted_v0";

export type MiniCutWorkspaceOpenResult =
	| {
			ok: true;
			status: MiniCutWorkspaceOpenStatus;
			storage: unknown;
			manifest: MiniCutWorkspaceManifest;
			dktManifest: unknown;
	  }
	| {
			ok: false;
			reason:
				| "unsupported_newer_version"
				| "incompatible"
				| "migration_required"
				| "storage_error";
			error: unknown;
			manifest: MiniCutWorkspaceManifest;
			dktManifest?: unknown;
	  };

type DktStorageOpenInspection =
	| { kind: "empty" }
	| { kind: "ready"; manifest: unknown }
	| { kind: "legacy_v0"; schema: unknown }
	| { kind: "newer_storage"; manifest: unknown }
	| { kind: "manifest_mismatch"; manifest: unknown }
	| { kind: "ambiguous_legacy_store" };

const HARNESS_ROOM_WORKSPACE_PREFIX = "harness:room:";
const HARNESS_STANDALONE_WORKSPACE_ID = "harness:standalone";
const DB_NAME_PREFIX = "minicut-crdt-workspace-";

const encodeWorkspacePart = (value: string): string =>
	encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
		`%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);

export const createMiniCutStoredDktManifest = (workspaceId: string) => {
	const manifest = createMiniCutExpectedManifest(workspaceId);
	return {
		manifestVersion: 1,
		storageVersion: manifest.dktStorageVersion,
		schemaVersion: manifest.appSchemaVersion,
		appId: manifest.appId,
		profileId: "minicut-crdt-v1",
		schemaDictionaryMode: manifest.schemaDictionaryMode,
		kind: manifest.kind,
		workspaceId: manifest.workspaceId,
		dktStorageVersion: manifest.dktStorageVersion,
		appSchemaVersion: manifest.appSchemaVersion,
		derivedSchemaVersion: manifest.derivedSchemaVersion,
		createdAt: new Date().toISOString(),
	};
};

export const createMiniCutExpectedManifest = (
	workspaceId: string,
): MiniCutWorkspaceManifest => ({
	kind: "dkt-workspace",
	manifestVersion: 1,
	workspaceId,
	appId: MINICUT_APP_ID,
	dktStorageVersion: MINICUT_DKT_STORAGE_VERSION,
	appSchemaVersion: MINICUT_APP_SCHEMA_VERSION,
	derivedSchemaVersion: MINICUT_DERIVED_SCHEMA_VERSION,
	schemaDictionaryMode: MINICUT_SCHEMA_DICTIONARY_MODE,
});

export const createMiniCutHarnessWorkspaceId = (
	roomId: string | null | undefined,
): string => {
	const normalized = typeof roomId === "string" ? roomId.trim() : "";
	return normalized
		? `${HARNESS_ROOM_WORKSPACE_PREFIX}${encodeWorkspacePart(normalized)}`
		: HARNESS_STANDALONE_WORKSPACE_ID;
};

export const readRoomIdFromMiniCutHarnessWorkspaceId = (
	workspaceId: string,
): string | null => {
	if (!workspaceId.startsWith(HARNESS_ROOM_WORKSPACE_PREFIX)) {
		return null;
	}
	const encoded = workspaceId.slice(HARNESS_ROOM_WORKSPACE_PREFIX.length);
	try {
		return decodeURIComponent(encoded);
	} catch {
		return null;
	}
};

export const createMiniCutWorkspaceDbName = (workspaceId: string): string =>
	`${DB_NAME_PREFIX}${encodeWorkspacePart(workspaceId)}`;

export const createMiniCutHarnessDbName = (
	roomId: string | null | undefined,
): string =>
	createMiniCutWorkspaceDbName(createMiniCutHarnessWorkspaceId(roomId));

const createDktExpectedOpenPolicy = (manifest: MiniCutWorkspaceManifest) => ({
	appId: manifest.appId,
	profileId: "minicut-crdt-v1",
	storageVersion: manifest.dktStorageVersion,
	schemaVersion: manifest.appSchemaVersion,
	schemaDictionaryMode: manifest.schemaDictionaryMode,
});

export const stageMiniCutWorkspaceManifest = ({
	storage,
	workspaceId,
}: {
	storage: unknown;
	workspaceId: string;
}) => {
	if (
		!storage ||
		typeof storage !== "object" ||
		typeof (storage as { putManifest?: unknown }).putManifest !== "function"
	) {
		return null;
	}
	const manifest = createMiniCutStoredDktManifest(workspaceId);
	(storage as { putManifest: (value: unknown) => void }).putManifest(manifest);
	return manifest;
};

export const openMiniCutWorkspaceStorage = async ({
	storage,
	workspaceId,
	adoptLegacyV0 = true,
}: {
	storage: unknown;
	workspaceId: string;
	adoptLegacyV0?: boolean;
}): Promise<MiniCutWorkspaceOpenResult> => {
	const manifest = createMiniCutExpectedManifest(workspaceId);
	const expected = createDktExpectedOpenPolicy(manifest);
	try {
		const inspected = (await inspectDktStorageForOpen(
			storage,
			expected,
		)) as DktStorageOpenInspection;

		if (inspected.kind === "empty") {
			return { ok: true, status: "empty", storage, manifest, dktManifest: null };
		}
		if (inspected.kind === "ready") {
			const inspectedWorkspaceId =
				typeof (inspected.manifest as { workspaceId?: unknown } | null)
					?.workspaceId === "string"
					? ((inspected.manifest as { workspaceId?: string }).workspaceId ?? null)
					: null;
			if (inspectedWorkspaceId && inspectedWorkspaceId !== workspaceId) {
				return {
					ok: false,
					reason: "incompatible",
					error: inspected,
					manifest,
					dktManifest: inspected.manifest,
				};
			}
			return {
				ok: true,
				status: "ready",
				storage,
				manifest,
				dktManifest: inspected.manifest,
			};
		}
		if (inspected.kind === "legacy_v0") {
			if (!adoptLegacyV0) {
				return {
					ok: false,
					reason: "migration_required",
					error: inspected,
					manifest,
				};
			}
			const adopted = await adoptLegacyDktStorageV0(storage, expected);
			return {
				ok: true,
				status: "adopted_v0",
				storage,
				manifest,
				dktManifest: adopted.manifest,
			};
		}
		if (inspected.kind === "newer_storage") {
			return {
				ok: false,
				reason: "unsupported_newer_version",
				error: inspected,
				manifest,
				dktManifest: inspected.manifest,
			};
		}
		return {
			ok: false,
			reason: "incompatible",
			error: inspected,
			manifest,
			dktManifest: "manifest" in inspected ? inspected.manifest : undefined,
		};
	} catch (error) {
		return { ok: false, reason: "storage_error", error, manifest };
	}
};
