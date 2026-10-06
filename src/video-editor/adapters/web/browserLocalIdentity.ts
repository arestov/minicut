const LOCAL_IDENTITY_DB_NAME = "minicut-local-identity";
const LOCAL_IDENTITY_STORE_NAME = "identity";
const LOCAL_IDENTITY_KEY = "localPeerId";

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
