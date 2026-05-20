import {
	adoptLegacyDktStorageV0,
	inspectDktStorageForOpen,
} from "dkt-all/libs/provoda/crdt/storage/atomic/dktStorageOpenPolicy.js";
import {
	WORKSPACE_EMPTY_INITIALIZED_STATE,
	WORKSPACE_OPEN_FAILURE,
	WORKSPACE_OPEN_STATUS,
	WORKSPACE_READY_STATE,
	createWorkspaceOpenFailedState,
	getWorkspaceOpenFailureLabel,
	getWorkspaceOpenStatusLabel,
	type WorkspaceOpenFailure,
	type WorkspaceOpenState,
} from "../runtime/workspaceOpenState";

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

export type MiniCutWorkspaceSourceOpenStatus = "empty" | "ready" | "adopted_v0";

export type MiniCutWorkspaceOpenFailure = Exclude<
	WorkspaceOpenFailure,
	typeof WORKSPACE_OPEN_FAILURE.NONE
>;

export type MiniCutWorkspaceReadyStatus =
	| typeof WORKSPACE_OPEN_STATUS.READY
	| typeof WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED;

export type MiniCutWorkspaceOpenResult =
	| {
			ok: true;
			status: MiniCutWorkspaceReadyStatus;
			statusLabel: string;
			sourceStatus: MiniCutWorkspaceSourceOpenStatus;
			openState: WorkspaceOpenState;
			storage: unknown;
			manifest: MiniCutWorkspaceManifest;
			dktManifest: unknown;
	  }
	| {
			ok: false;
			status: typeof WORKSPACE_OPEN_STATUS.FAILED;
			statusLabel: string;
			failureReason: MiniCutWorkspaceOpenFailure;
			failureReasonLabel: string;
			openState: WorkspaceOpenState;
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
const PEER_ID_PREFIX = "minicut-peer:";
const LOCAL_IDENTITY_DB_NAME = "minicut-local-identity";
const LOCAL_IDENTITY_STORE_NAME = "identity";
const LOCAL_IDENTITY_KEY = "localPeerId";

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

const hashWorkspaceId = (workspaceId: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < workspaceId.length; index += 1) {
		hash ^= workspaceId.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
};

export const createMiniCutRoomPeerId = (
	workspaceId: string,
	localIdentity: string,
): string =>
	`${PEER_ID_PREFIX}${encodeWorkspacePart(localIdentity)}:${hashWorkspaceId(workspaceId)}`;

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
		request.onsuccess = () => resolve(request.result);
	});

const openLocalIdentityDb = (indexedDBFactory: IDBFactory): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = indexedDBFactory.open(LOCAL_IDENTITY_DB_NAME, 1);
		request.onerror = () => reject(request.error ?? new Error("Failed to open MiniCut local identity DB"));
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(LOCAL_IDENTITY_STORE_NAME)) {
				db.createObjectStore(LOCAL_IDENTITY_STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
	});

const createLocalPeerIdentity = (): string => {
	if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
		throw new Error("MiniCut CRDT local identity requires crypto.randomUUID");
	}
	return crypto.randomUUID();
};

export const getOrCreateMiniCutLocalPeerIdentity = async (
	indexedDBFactory: IDBFactory = indexedDB,
): Promise<string> => {
	if (!indexedDBFactory) {
		throw new Error("MiniCut CRDT local identity requires IndexedDB");
	}
	const db = await openLocalIdentityDb(indexedDBFactory);
	try {
		const readTx = db.transaction(LOCAL_IDENTITY_STORE_NAME, "readonly");
		const existing = await requestToPromise<string | undefined>(
			readTx.objectStore(LOCAL_IDENTITY_STORE_NAME).get(LOCAL_IDENTITY_KEY),
		);
		if (typeof existing === "string" && existing.length > 0) {
			return existing;
		}
		const next = createLocalPeerIdentity();
		const writeTx = db.transaction(LOCAL_IDENTITY_STORE_NAME, "readwrite");
		await requestToPromise(
			writeTx.objectStore(LOCAL_IDENTITY_STORE_NAME).put(next, LOCAL_IDENTITY_KEY),
		);
		return next;
	} finally {
		db.close();
	}
};

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

const createReadyOpenResult = ({
	status,
	sourceStatus,
	storage,
	manifest,
	dktManifest,
}: {
	status: MiniCutWorkspaceReadyStatus;
	sourceStatus: MiniCutWorkspaceSourceOpenStatus;
	storage: unknown;
	manifest: MiniCutWorkspaceManifest;
	dktManifest: unknown;
}): Extract<MiniCutWorkspaceOpenResult, { ok: true }> => {
	const openState =
		status === WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED
			? WORKSPACE_EMPTY_INITIALIZED_STATE
			: WORKSPACE_READY_STATE;
	return {
		ok: true,
		status,
		statusLabel: getWorkspaceOpenStatusLabel(status),
		sourceStatus,
		openState,
		storage,
		manifest,
		dktManifest,
	};
};

const createFailedOpenResult = ({
	failureReason,
	error,
	manifest,
	dktManifest,
}: {
	failureReason: MiniCutWorkspaceOpenFailure;
	error: unknown;
	manifest: MiniCutWorkspaceManifest;
	dktManifest?: unknown;
}): Extract<MiniCutWorkspaceOpenResult, { ok: false }> => {
	const openState = createWorkspaceOpenFailedState(failureReason);
	return {
		ok: false,
		status: WORKSPACE_OPEN_STATUS.FAILED,
		statusLabel: getWorkspaceOpenStatusLabel(WORKSPACE_OPEN_STATUS.FAILED),
		failureReason,
		failureReasonLabel: getWorkspaceOpenFailureLabel(failureReason),
		openState,
		error,
		manifest,
		...(dktManifest === undefined ? null : { dktManifest }),
	};
};

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
			return createReadyOpenResult({
				status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
				sourceStatus: "empty",
				storage,
				manifest,
				dktManifest: null,
			});
		}
		if (inspected.kind === "ready") {
			const inspectedWorkspaceId =
				typeof (inspected.manifest as { workspaceId?: unknown } | null)
					?.workspaceId === "string"
					? ((inspected.manifest as { workspaceId?: string }).workspaceId ?? null)
					: null;
			if (inspectedWorkspaceId && inspectedWorkspaceId !== workspaceId) {
				return createFailedOpenResult({
					failureReason: WORKSPACE_OPEN_FAILURE.INCOMPATIBLE,
					error: inspected,
					manifest,
					dktManifest: inspected.manifest,
				});
			}
			return createReadyOpenResult({
				status: WORKSPACE_OPEN_STATUS.READY,
				sourceStatus: "ready",
				storage,
				manifest,
				dktManifest: inspected.manifest,
			});
		}
		if (inspected.kind === "legacy_v0") {
			if (!adoptLegacyV0) {
				return createFailedOpenResult({
					failureReason: WORKSPACE_OPEN_FAILURE.MIGRATION_REQUIRED,
					error: inspected,
					manifest,
				});
			}
			const adopted = await adoptLegacyDktStorageV0(storage, expected);
			return createReadyOpenResult({
				status: WORKSPACE_OPEN_STATUS.READY,
				sourceStatus: "adopted_v0",
				storage,
				manifest,
				dktManifest: adopted.manifest,
			});
		}
		if (inspected.kind === "newer_storage") {
			return createFailedOpenResult({
				failureReason: WORKSPACE_OPEN_FAILURE.UNSUPPORTED_NEWER_VERSION,
				error: inspected,
				manifest,
				dktManifest: inspected.manifest,
			});
		}
		return createFailedOpenResult({
			failureReason: WORKSPACE_OPEN_FAILURE.INCOMPATIBLE,
			error: inspected,
			manifest,
			dktManifest: "manifest" in inspected ? inspected.manifest : undefined,
		});
	} catch (error) {
		return createFailedOpenResult({
			failureReason: WORKSPACE_OPEN_FAILURE.STORAGE_ERROR,
			error: error,
			manifest,
		});
	}
};
