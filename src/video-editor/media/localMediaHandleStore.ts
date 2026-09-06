export const LOCAL_MEDIA_HANDLE_DB_NAME = "minicut-local-media-handles-v1";
export const LOCAL_MEDIA_HANDLE_STORE_NAME = "handles";
export const LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME = "handleVersions";
export type LocalMediaHandleVersionRef = `project/${string}/resource/${string}/handle/${string}`;

export type LocalMediaHandleRecord = {
	resourceId: string;
	handle: FileSystemFileHandle;
	name: string;
	size: number | null;
	lastModified: number | null;
	mime: string;
	createdAt: number;
	updatedAt: number;
};

export type LocalMediaHandleVersionRecord = LocalMediaHandleRecord & {
	handleRef: LocalMediaHandleVersionRef;
	projectId: string;
	operationId: string;
};

export type LocalMediaHandleDiagnostics = {
	dbName: string;
	storeName: string;
	handleCount: number;
};

type IndexedDbFactoryLike = Pick<IDBFactory, "open">;

const requestToPromise = <Value>(request: IDBRequest<Value>): Promise<Value> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB request failed"));
	});

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed"));
	});

const openDb = (
	indexedDBFactory: IndexedDbFactoryLike = globalThis.indexedDB,
): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		if (!indexedDBFactory) {
			reject(new Error("IndexedDB is unavailable"));
			return;
		}
		const request = indexedDBFactory.open(LOCAL_MEDIA_HANDLE_DB_NAME, 2);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(LOCAL_MEDIA_HANDLE_STORE_NAME)) {
				db.createObjectStore(LOCAL_MEDIA_HANDLE_STORE_NAME, {
					keyPath: "resourceId",
				});
			}
			if (!db.objectStoreNames.contains(LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME)) {
				const versions = db.createObjectStore(LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME, { keyPath: "handleRef" });
				versions.createIndex("resourceId", "resourceId", { unique: false });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("Unable to open local media handle DB"));
	});

const containsBytePayload = (value: unknown, seen = new Set<object>()): boolean => {
	if (!value || typeof value !== "object") {
		return false;
	}
	if (
		value instanceof Blob ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value)
	) {
		return true;
	}
	if (seen.has(value)) {
		return false;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		return value.some((entry) => containsBytePayload(entry, seen));
	}
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (key === "handle") {
			continue;
		}
		if (containsBytePayload(entry, seen)) {
			return true;
		}
	}
	return false;
};

const validateRecord = (record: LocalMediaHandleRecord): void => {
	if (!record.resourceId) {
		throw new Error("Local media handle record requires resourceId");
	}
	if (!record.handle || typeof record.handle !== "object") {
		throw new Error("Local media handle record requires a file handle");
	}
	if (containsBytePayload(record)) {
		throw new Error("Local media handle store must not persist media bytes");
	}
};

const normalizeRecord = (
	record: LocalMediaHandleRecord | (Omit<LocalMediaHandleRecord, "size" | "lastModified"> & {
		size?: number | null;
		lastModified?: number | null;
	}),
): LocalMediaHandleRecord => ({
	...record,
	size: typeof record.size === "number" ? record.size : null,
	lastModified:
		typeof record.lastModified === "number" ? record.lastModified : null,
});

export const createLocalMediaHandleStore = (
	indexedDBFactory: IndexedDbFactoryLike = globalThis.indexedDB,
) => {
	const withStore = async <Value>(
		mode: IDBTransactionMode,
		fn: (store: IDBObjectStore) => IDBRequest<Value>,
		storeName = LOCAL_MEDIA_HANDLE_STORE_NAME,
	): Promise<Value> => {
		const db = await openDb(indexedDBFactory);
		try {
			const transaction = db.transaction(storeName, mode);
			const store = transaction.objectStore(storeName);
			const request = fn(store);
			const result = await requestToPromise(request);
			await transactionDone(transaction);
			return result;
		} finally {
			db.close();
		}
	};

	const safeSegment = (value: string) => {
		if (!value || value === "." || value === ".." || /[\\/]/.test(value)) throw new Error("Invalid local media handle key");
		return value;
	};
	const makeRef = (projectId: string, resourceId: string, operationId: string): LocalMediaHandleVersionRef =>
		`project/${safeSegment(projectId)}/resource/${safeSegment(resourceId)}/handle/${safeSegment(operationId)}`;
	const api = {
		async put(record: LocalMediaHandleRecord): Promise<void> {
			validateRecord(record);
			await withStore("readwrite", (store) => store.put(record));
		},
		async get(resourceId: string): Promise<LocalMediaHandleRecord | null> {
			if (!resourceId) return null;
			const record = (await withStore("readonly", (store) =>
				store.get(resourceId),
			)) as LocalMediaHandleRecord | undefined;
			return record ? normalizeRecord(record) : null;
		},
		async delete(resourceId: string): Promise<void> {
			if (!resourceId) return;
			await withStore("readwrite", (store) => store.delete(resourceId));
		},
		async diagnostics(): Promise<LocalMediaHandleDiagnostics> {
			const legacyCount = await withStore("readonly", (store) => store.count());
			const versionCount = await withStore("readonly", (store) => store.count(), LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME);
			return {
				dbName: LOCAL_MEDIA_HANDLE_DB_NAME,
				storeName: LOCAL_MEDIA_HANDLE_STORE_NAME,
				handleCount: legacyCount + versionCount,
			};
		},
		async stage(projectId: string, resourceId: string, operationId: string, record: LocalMediaHandleRecord): Promise<LocalMediaHandleVersionRef> {
			validateRecord(record);
			const handleRef = makeRef(projectId, resourceId, operationId);
			const version: LocalMediaHandleVersionRecord = { ...normalizeRecord(record), resourceId, projectId, operationId, handleRef };
			await withStore("readwrite", (store) => store.put(version), LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME);
			return handleRef;
		},
		async getByRef(handleRef: string): Promise<LocalMediaHandleVersionRecord | null> {
			const record = await withStore("readonly", (store) => store.get(handleRef), LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME) as LocalMediaHandleVersionRecord | undefined;
			return record ? { ...normalizeRecord(record), handleRef: record.handleRef, projectId: record.projectId, operationId: record.operationId } : null;
		},
		async validate(handleRef: string): Promise<boolean> { return (await api.getByRef(handleRef)) !== null; },
		async publishOutcome(handleRef: string): Promise<boolean> { return api.validate(handleRef); },
		async rollback(handleRef: string): Promise<void> { await withStore("readwrite", (store) => store.delete(handleRef), LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME); },
		async reconcile(resourceId: string, publishedHandleRef: string | null): Promise<{ kept: string[]; removed: string[] }> {
			const records = await withStore("readonly", (store) => store.index("resourceId").getAll(resourceId), LOCAL_MEDIA_HANDLE_VERSION_STORE_NAME) as LocalMediaHandleVersionRecord[];
			const result = { kept: [] as string[], removed: [] as string[] };
			for (const record of records) { if (record.handleRef === publishedHandleRef) result.kept.push(record.handleRef); else { await api.rollback(record.handleRef); result.removed.push(record.handleRef); } }
			return result;
		},
		async cleanup(resourceId: string, publishedHandleRef: string): Promise<number> { return (await api.reconcile(resourceId, publishedHandleRef)).removed.length; },
		async migrateLegacy(projectId: string, resourceId: string, operationId: string): Promise<LocalMediaHandleVersionRef | null> {
			const legacy = await api.get(resourceId); if (!legacy) return null;
			const ref = await api.stage(projectId, resourceId, operationId, legacy);
			return await api.validate(ref) ? ref : null;
		},
	};
	return api;
};
