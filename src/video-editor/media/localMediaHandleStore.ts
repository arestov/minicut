export const LOCAL_MEDIA_HANDLE_DB_NAME = "minicut-local-media-handles-v1";
export const LOCAL_MEDIA_HANDLE_STORE_NAME = "handles";

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
		const request = indexedDBFactory.open(LOCAL_MEDIA_HANDLE_DB_NAME, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(LOCAL_MEDIA_HANDLE_STORE_NAME)) {
				db.createObjectStore(LOCAL_MEDIA_HANDLE_STORE_NAME, {
					keyPath: "resourceId",
				});
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

export const createLocalMediaHandleStore = (
	indexedDBFactory: IndexedDbFactoryLike = globalThis.indexedDB,
) => {
	const withStore = async <Value>(
		mode: IDBTransactionMode,
		fn: (store: IDBObjectStore) => IDBRequest<Value>,
	): Promise<Value> => {
		const db = await openDb(indexedDBFactory);
		try {
			const transaction = db.transaction(LOCAL_MEDIA_HANDLE_STORE_NAME, mode);
			const store = transaction.objectStore(LOCAL_MEDIA_HANDLE_STORE_NAME);
			const request = fn(store);
			const result = await requestToPromise(request);
			await transactionDone(transaction);
			return result;
		} finally {
			db.close();
		}
	};

	return {
		async put(record: LocalMediaHandleRecord): Promise<void> {
			validateRecord(record);
			await withStore("readwrite", (store) => store.put(record));
		},
		async get(resourceId: string): Promise<LocalMediaHandleRecord | null> {
			if (!resourceId) return null;
			const record = (await withStore("readonly", (store) =>
				store.get(resourceId),
			)) as LocalMediaHandleRecord | undefined;
			return record ?? null;
		},
		async delete(resourceId: string): Promise<void> {
			if (!resourceId) return;
			await withStore("readwrite", (store) => store.delete(resourceId));
		},
		async diagnostics(): Promise<LocalMediaHandleDiagnostics> {
			const handleCount = await withStore("readonly", (store) => store.count());
			return {
				dbName: LOCAL_MEDIA_HANDLE_DB_NAME,
				storeName: LOCAL_MEDIA_HANDLE_STORE_NAME,
				handleCount,
			};
		},
	};
};
