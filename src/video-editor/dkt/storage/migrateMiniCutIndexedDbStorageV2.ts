import {
	createDktStorageV2Manifest,
} from "dkt-all/libs/provoda/crdt/storage/atomic/dktStorageOpenPolicy.js";
import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { runDktStorageRequest, type DktStorageRequest } from "./dktStorageRequest";

const DKT_STORES = [
	"dkt_manifest",
	"dkt_migration_history",
	"dkt_schema",
	"dkt_meta",
	"dkt_models",
	"dkt_removed_models",
	"dkt_attrs",
	"dkt_rels",
	"dkt_mentions",
	"dkt_mention_names",
	"dkt_expected_rels",
] as const;

type LegacyEntry = readonly [IDBValidKey, unknown];

type LegacySnapshot = {
	manifest: unknown;
	schema: unknown;
	meta: unknown;
	models: LegacyEntry[];
	removedModelIds: Set<string>;
	attrs: LegacyEntry[];
	rels: LegacyEntry[];
	mentions: LegacyEntry[];
	expectedRels: LegacyEntry[];
};

type MigrationStorage = {
	putSchema: (schema: unknown) => void;
	getCompiledSchema?: () => Record<string, unknown> | null;
	prepareDictionaryNames?: (names: string[]) => Record<string, number>;
	putProjectMeta?: (meta: unknown) => void;
	createModel: (id: string, modelName: string) => void;
	updateModelAttrs: (id: string, attrs: unknown[]) => void;
	updateModelRel: (id: string, fieldId: number, value: unknown) => void;
	updateModelMention: (
		id: string,
		modelName: string,
		fieldId: number,
		value: unknown,
	) => void;
	createExpectedRel: (key: string, value: unknown) => void;
	putManifest: (manifest: unknown) => void;
	appendMigrationRecord?: DktStorageRequest<unknown, [unknown]>;
	commitChanges: DktStorageRequest<unknown, [unknown]>;
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB migration read failed"));
		request.onsuccess = () => resolve(request.result);
	});

const transactionToPromise = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB migration read aborted"));
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB migration read failed"));
	});

const openDatabase = (
	indexedDBFactory: IDBFactory,
	dbName: string,
	version: number,
): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = indexedDBFactory.open(dbName, version);
		request.onerror = () =>
			reject(request.error ?? new Error(`Failed to open IndexedDB ${dbName}`));
		request.onsuccess = () => resolve(request.result);
	});

const getEntries = async (
	transaction: IDBTransaction,
	storeName: string,
): Promise<LegacyEntry[]> => {
	if (!transaction.db.objectStoreNames.contains(storeName)) return [];
	const store = transaction.objectStore(storeName);
	const [keys, values] = await Promise.all([
		requestToPromise(store.getAllKeys()),
		requestToPromise(store.getAll()),
	]);
	return keys.map((key, index) => [key, values[index]] as const);
};

const valueAt = (entries: LegacyEntry[], key: IDBValidKey): unknown =>
	entries.find(([entryKey]) => String(entryKey) === String(key))?.[1] ?? null;

export const readMiniCutIndexedDbV1Snapshot = async ({
	indexedDB: indexedDBFactory,
	dbName,
	version,
}: {
	indexedDB: IDBFactory;
	dbName: string;
	version: number;
}): Promise<LegacySnapshot> => {
	const db = await openDatabase(indexedDBFactory, dbName, version);
	try {
		const existingStores = DKT_STORES.filter((name) =>
			db.objectStoreNames.contains(name),
		);
		const transaction = db.transaction(existingStores, "readonly");
		const transactionDone = transactionToPromise(transaction);
		const reads = Object.fromEntries(
			await Promise.all(
				existingStores.map(async (name) => [name, await getEntries(transaction, name)]),
			),
		) as Record<string, LegacyEntry[]>;
		await transactionDone;
		return {
			manifest: valueAt(reads.dkt_manifest ?? [], "manifest"),
			schema: valueAt(reads.dkt_schema ?? [], "schema"),
			meta: valueAt(reads.dkt_meta ?? [], "project"),
			models: reads.dkt_models ?? [],
			removedModelIds: new Set(
				(reads.dkt_removed_models ?? []).map(([key]) => String(key)),
			),
			attrs: reads.dkt_attrs ?? [],
			rels: reads.dkt_rels ?? [],
			mentions: reads.dkt_mentions ?? [],
			expectedRels: reads.dkt_expected_rels ?? [],
		};
	} finally {
		db.close();
	}
};

const compoundField = (key: IDBValidKey): [string, string] | null =>
	Array.isArray(key) && key.length === 2
		? [String(key[0]), String(key[1])]
		: null;

const requireFieldId = (
	compiledSchema: Record<string, unknown>,
	modelName: string,
	kind: "attr" | "rel",
	fieldName: string,
): number => {
	const modelSchema = compiledSchema[modelName] as
		| {
				storage_attr_ids_by_name?: Record<string, number>;
				storage_rel_ids_by_name?: Record<string, number>;
		  }
		| undefined;
	const fieldId =
		kind === "attr"
			? modelSchema?.storage_attr_ids_by_name?.[fieldName]
			: modelSchema?.storage_rel_ids_by_name?.[fieldName];
	if (!Number.isSafeInteger(fieldId)) {
		throw new Error(
			`MiniCut storage-v2 migration missing ${kind} field id for ${modelName}.${fieldName}`,
		);
	}
	return fieldId as number;
};

export const migrateMiniCutIndexedDbStorageV1ToV2 = async ({
	indexedDB,
	dbName,
	version,
	storage,
	workspaceId,
}: {
	indexedDB: IDBFactory;
	dbName: string;
	version: number;
	storage: MigrationStorage;
	workspaceId: string;
}) => {
	const snapshot = await readMiniCutIndexedDbV1Snapshot({ indexedDB, dbName, version });
	if (
		!snapshot.manifest ||
		typeof snapshot.manifest !== "object" ||
		(snapshot.manifest as { storageVersion?: unknown }).storageVersion !== 1
	) {
		return null;
	}
	if (!snapshot.schema) {
		throw new Error("MiniCut storage-v2 migration requires the persisted v1 schema");
	}

	// Compile and validate the complete rewrite against a disposable storage first.
	// Nothing is staged in the real coordinator until every persisted field can be
	// mapped, so a validation failure cannot be committed later by close().
	const scratchStorage = makeDktCrdtMemoryStorage().dktStorage as MigrationStorage;
	scratchStorage.putSchema(snapshot.schema);
	const compiledSchema = scratchStorage.getCompiledSchema?.();
	if (!compiledSchema) {
		throw new Error("MiniCut storage-v2 migration requires compiled schema metadata");
	}
	const modelNames = new Map<string, string>();
	for (const [key, value] of snapshot.models) {
		const id = String(key);
		if (snapshot.removedModelIds.has(id)) continue;
		const modelName = String(value);
		modelNames.set(id, modelName);
	}

	const attrsToWrite: Array<[string, number, unknown]> = [];
	for (const [key, value] of snapshot.attrs) {
		const field = compoundField(key);
		if (!field || !modelNames.has(field[0])) continue;
		attrsToWrite.push([field[0],
			requireFieldId(compiledSchema, modelNames.get(field[0])!, "attr", field[1]),
			value,
		]);
	}
	const relsToWrite: Array<[string, number, unknown]> = [];
	for (const [key, value] of snapshot.rels) {
		const field = compoundField(key);
		if (!field || !modelNames.has(field[0])) continue;
		relsToWrite.push([
			field[0],
			requireFieldId(compiledSchema, modelNames.get(field[0])!, "rel", field[1]),
			value,
		]);
	}

	const mentionFields = snapshot.mentions
		.map(([key]) => compoundField(key))
		.filter((value): value is [string, string] => value != null);
	const dynamicMentionNames = mentionFields
		.filter(([id, name]) => {
			const modelName = modelNames.get(id);
			if (!modelName) return false;
			try {
				requireFieldId(compiledSchema, modelName, "rel", name);
				return false;
			} catch {
				return true;
			}
		})
		.map(([, name]) => name);
	const preparedMentionIds = scratchStorage.prepareDictionaryNames?.([
		...new Set(dynamicMentionNames),
	]) ?? {};
	const mentionsToWrite: Array<[string, string, string, unknown]> = [];
	for (const [key, value] of snapshot.mentions) {
		const field = compoundField(key);
		if (!field || !modelNames.has(field[0])) continue;
		const modelName = modelNames.get(field[0])!;
		let fieldId: number;
		try {
			fieldId = requireFieldId(compiledSchema, modelName, "rel", field[1]);
		} catch {
			fieldId = preparedMentionIds[field[1]];
		}
		if (!Number.isSafeInteger(fieldId)) {
			throw new Error(`MiniCut storage-v2 migration missing mention field id for ${field[1]}`);
		}
		mentionsToWrite.push([field[0], modelName, field[1], value]);
	}

	storage.putSchema(snapshot.schema);
	if (snapshot.meta != null) storage.putProjectMeta?.(snapshot.meta);
	const actualMentionIds = storage.prepareDictionaryNames?.([
		...new Set(dynamicMentionNames),
	]) ?? {};
	for (const [id, modelName] of modelNames) storage.createModel(id, modelName);
	for (const [id, fieldId, value] of attrsToWrite) {
		storage.updateModelAttrs(id, [fieldId, value]);
	}
	for (const [id, fieldId, value] of relsToWrite) {
		storage.updateModelRel(id, fieldId, value);
	}
	for (const [id, modelName, fieldName, value] of mentionsToWrite) {
		let fieldId: number;
		try {
			fieldId = requireFieldId(compiledSchema, modelName, "rel", fieldName);
		} catch {
			fieldId = actualMentionIds[fieldName];
		}
		storage.updateModelMention(id, modelName, fieldId, value);
	}
	for (const [key, value] of snapshot.expectedRels) {
		storage.createExpectedRel(String(key), value);
	}

	const migrationId = "minicut-indexeddb-storage-v2";
	const createdAt = new Date().toISOString();
	const manifest = {
		...createDktStorageV2Manifest({
			createdAt,
			lastExtendedByMigration: migrationId,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			schemaVersion: 1,
		}),
		kind: "dkt-workspace",
		workspaceId,
		dktStorageVersion: 2,
		appSchemaVersion: 1,
		derivedSchemaVersion: 1,
	};
	storage.putManifest(manifest);
	const record = {
		id: migrationId,
		fromStorageVersion: 1,
		toStorageVersion: 2,
		createdAt,
		modelCount: modelNames.size,
	};
	if (storage.appendMigrationRecord) {
		await runDktStorageRequest(storage.appendMigrationRecord, record);
	}
	await runDktStorageRequest(storage.commitChanges, { migrationId });
	return { manifest, record };
};
