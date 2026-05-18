import {
	createMiniCutHarnessDbName,
	createMiniCutHarnessWorkspaceId,
} from "../storage/minicutWorkspaceManifest";

export const CRDT_HARNESS_INDEXEDDB_NAME = createMiniCutHarnessDbName(null);

export const CRDT_HARNESS_RESET_MARKER = "minicut:crdt-harness-reset";

export const isCrdtHarnessResetScheduled = (): boolean =>
	typeof window !== "undefined" &&
	window.sessionStorage.getItem(CRDT_HARNESS_RESET_MARKER) === "1";

export const scheduleCrdtHarnessReset = (): void => {
	if (typeof window === "undefined") {
		return;
	}
	window.sessionStorage.setItem(CRDT_HARNESS_RESET_MARKER, "1");
	window.location.reload();
};

export const clearCrdtHarnessResetMarker = (): void => {
	if (typeof window === "undefined") {
		return;
	}
	window.sessionStorage.removeItem(CRDT_HARNESS_RESET_MARKER);
};

export const createCrdtHarnessStorageMetadata = (
	roomId: string | null | undefined,
) => {
	const workspaceId = createMiniCutHarnessWorkspaceId(roomId);
	return {
		roomId: typeof roomId === "string" && roomId ? roomId : null,
		workspaceId,
		dbName: createMiniCutHarnessDbName(roomId),
	};
};

export const resetCrdtHarnessIndexedDB = (
	dbName = CRDT_HARNESS_INDEXEDDB_NAME,
): Promise<void> =>
	new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is unavailable"));
			return;
		}

		const request = indexedDB.deleteDatabase(dbName);
		request.onerror = () =>
			reject(request.error ?? new Error("Failed to delete CRDT IndexedDB"));
		request.onblocked = () =>
			reject(new Error("CRDT IndexedDB reset is blocked by an open connection"));
		request.onsuccess = () => resolve();
	});
