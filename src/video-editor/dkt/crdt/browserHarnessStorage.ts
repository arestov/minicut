export const CRDT_HARNESS_INDEXEDDB_NAME = "minicut-crdt-minicut-browser";

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

export const resetCrdtHarnessIndexedDB = (): Promise<void> =>
	new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is unavailable"));
			return;
		}

		const request = indexedDB.deleteDatabase(CRDT_HARNESS_INDEXEDDB_NAME);
		request.onerror = () =>
			reject(request.error ?? new Error("Failed to delete CRDT IndexedDB"));
		request.onblocked = () =>
			reject(new Error("CRDT IndexedDB reset is blocked by an open connection"));
		request.onsuccess = () => resolve();
	});
