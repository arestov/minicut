import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { makeDktCrdtIndexedDBStorage } from "dkt/crdt/storage/indexeddb.js";
import { describe, expect, it } from "vitest";
import { runDktStorageRequest, type DktStorageRequest } from "./dktStorageRequest";
import { openMiniCutWorkspaceStorage } from "./minicutWorkspaceManifest";
import {
	migrateMiniCutIndexedDbStorageV1ToV2,
	readMiniCutIndexedDbV1Snapshot,
} from "./migrateMiniCutIndexedDbStorageV2";

const version = 2;

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error);
		transaction.onerror = () => reject(transaction.error);
	});

const openDb = (dbName: string): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, version);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});

const seedV1Workspace = async (dbName: string) => {
	const empty = await makeDktCrdtIndexedDBStorage({
		indexedDB,
		keyRange: IDBKeyRange,
		dbName,
		version,
	});
	await empty.close();
	const db = await openDb(dbName);
	try {
		const transaction = db.transaction(
			["dkt_manifest", "dkt_schema", "dkt_models", "dkt_attrs", "dkt_rels"],
			"readwrite",
		);
		const done = transactionDone(transaction);
		transaction.objectStore("dkt_manifest").put(
			{
				manifestVersion: 1,
				storageVersion: 1,
				schemaVersion: 1,
				appId: "minicut",
				workspaceId: "harness:room:migrate-v1",
			},
			"manifest",
		);
		transaction.objectStore("dkt_schema").put(
			{
				Example: {
					attrs: [{ name: "title", is_input: true }],
					rels: [{ name: "children", is_input: true }],
				},
			},
			"schema",
		);
		transaction.objectStore("dkt_models").put("Example", "node-1");
		transaction.objectStore("dkt_models").put("Example", "node-2");
		transaction.objectStore("dkt_attrs").put("Draft", ["node-1", "title"]);
		transaction.objectStore("dkt_rels").put(["node-2"], ["node-1", "children"]);
		await done;
	} finally {
		db.close();
	}
};

const putLegacyAttr = async (
	dbName: string,
	name: string,
	value: unknown,
) => {
	const db = await openDb(dbName);
	try {
		const transaction = db.transaction("dkt_attrs", "readwrite");
		const done = transactionDone(transaction);
		transaction.objectStore("dkt_attrs").put(value, ["node-1", name]);
		await done;
	} finally {
		db.close();
	}
};

describe("MiniCut IndexedDB storage v2 migration", () => {
	it("rewrites v1 string field coordinates and reopens idempotently", async () => {
		const dbName = `minicut-storage-v2-${Date.now()}-${Math.random()}`;
		await seedV1Workspace(dbName);
		const storagePackage = await makeDktCrdtIndexedDBStorage({
			indexedDB,
			keyRange: IDBKeyRange,
			dbName,
			version,
		});
		const dktStorage = storagePackage.dktStorage as {
			getManifest: DktStorageRequest<unknown>;
			getSnapshot: DktStorageRequest<unknown>;
		};

		const migrated = await openMiniCutWorkspaceStorage({
			storage: storagePackage.dktStorage,
			workspaceId: "harness:room:migrate-v1",
			migrateStorageV1: () =>
				migrateMiniCutIndexedDbStorageV1ToV2({
					indexedDB,
					dbName,
					version,
					storage: storagePackage.dktStorage as never,
					workspaceId: "harness:room:migrate-v1",
				}),
		});
		expect(migrated).toMatchObject({
			ok: true,
			sourceStatus: "migrated_v1",
			dktManifest: {
			storageVersion: 2,
			workspaceId: "harness:room:migrate-v1",
			valueCodec: "tagged-v1",
			relCodec: "utf8-var",
			nameDict: { mode: "plain-string-to-number", version: 1 },
			schemaFieldMetadata: true,
			},
		});
		expect(await runDktStorageRequest(dktStorage.getSnapshot)).toMatchObject({
			models: {
				"node-1": {
					model_name: "Example",
					attrs: { title: "Draft" },
					rels: { children: ["node-2"] },
				},
			},
		});
		await storagePackage.close();

		const reopened = await makeDktCrdtIndexedDBStorage({
			indexedDB,
			keyRange: IDBKeyRange,
			dbName,
			version,
		});
		await expect(
			openMiniCutWorkspaceStorage({
				storage: reopened.dktStorage,
				workspaceId: "harness:room:migrate-v1",
				migrateStorageV1: () =>
					migrateMiniCutIndexedDbStorageV1ToV2({
						indexedDB,
						dbName,
						version,
						storage: reopened.dktStorage as never,
						workspaceId: "harness:room:migrate-v1",
					}),
			}),
		).resolves.toMatchObject({ ok: true, sourceStatus: "ready" });
		await expect(
			runDktStorageRequest(
				(reopened.dktStorage as { getManifest: DktStorageRequest<unknown> })
					.getManifest,
			),
		).resolves.toMatchObject({ storageVersion: 2 });
		await expect(
			runDktStorageRequest(
				(reopened.dktStorage as { getSnapshot: DktStorageRequest<unknown> })
					.getSnapshot,
			),
		).resolves.toMatchObject({
			models: { "node-1": { attrs: { title: "Draft" } } },
		});
		await reopened.close();
	});

	it("leaves the v1 manifest intact when validation fails before commit", async () => {
		const dbName = `minicut-storage-v2-invalid-${Date.now()}-${Math.random()}`;
		await seedV1Workspace(dbName);
		await putLegacyAttr(dbName, "missingTitle", "cannot-map");
		const storagePackage = await makeDktCrdtIndexedDBStorage({
			indexedDB,
			keyRange: IDBKeyRange,
			dbName,
			version,
		});

		await expect(
			migrateMiniCutIndexedDbStorageV1ToV2({
				indexedDB,
				dbName,
				version,
				storage: storagePackage.dktStorage as never,
				workspaceId: "harness:room:migrate-v1",
			}),
		).rejects.toThrow("missing attr field id for Example.missingTitle");
		await storagePackage.close();

		await expect(
			readMiniCutIndexedDbV1Snapshot({ indexedDB, dbName, version }),
		).resolves.toMatchObject({ manifest: { storageVersion: 1 } });
	});
});
