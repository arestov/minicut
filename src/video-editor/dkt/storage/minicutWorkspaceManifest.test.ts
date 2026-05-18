import { describe, expect, it } from "vitest";
import {
	createMiniCutExpectedManifest,
	createMiniCutHarnessDbName,
	createMiniCutHarnessWorkspaceId,
	createMiniCutWorkspaceDbName,
	openMiniCutWorkspaceStorage,
	readRoomIdFromMiniCutHarnessWorkspaceId,
} from "./minicutWorkspaceManifest";

const createMemoryDktStorage = (initial: {
	manifest?: unknown;
	schema?: unknown;
	unknownData?: boolean;
} = {}) => {
	let manifest: unknown = initial.manifest ?? null;
	const migrations: unknown[] = [];
	return {
		getManifest: async () => manifest,
		putManifest: (next: unknown) => {
			manifest = next;
		},
		getSchema: async () => initial.schema ?? null,
		hasUnknownData: async () => initial.unknownData === true,
		appendMigrationRecord: async (record: unknown) => {
			migrations.push(record);
		},
		commitChanges: async () => undefined,
		readManifest: () => manifest,
		readMigrations: () => migrations.slice(),
	};
};

describe("MiniCut workspace manifest", () => {
	it("returns stable manifest constants", () => {
		expect(createMiniCutExpectedManifest("harness:room:alpha")).toEqual({
			kind: "dkt-workspace",
			manifestVersion: 1,
			workspaceId: "harness:room:alpha",
			appId: "minicut",
			dktStorageVersion: 1,
			appSchemaVersion: 1,
			derivedSchemaVersion: 1,
			schemaDictionaryMode: "none",
		});
	});

	it("derives reversible harness workspace ids from room ids", () => {
		const workspaceId = createMiniCutHarnessWorkspaceId("room alpha/1");
		expect(workspaceId).toBe("harness:room:room%20alpha%2F1");
		expect(readRoomIdFromMiniCutHarnessWorkspaceId(workspaceId)).toBe(
			"room alpha/1",
		);
	});

	it("uses an explicit standalone harness identity when room id is absent", () => {
		expect(createMiniCutHarnessWorkspaceId(null)).toBe("harness:standalone");
		expect(createMiniCutHarnessDbName(null)).toBe(
			createMiniCutWorkspaceDbName("harness:standalone"),
		);
	});

	it("maps empty DKT storage to MiniCut empty without writing initial graph", async () => {
		const storage = createMemoryDktStorage();
		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:empty",
		});

		expect(result).toMatchObject({ ok: true, status: "empty" });
		expect(storage.readManifest()).toBeNull();
	});

	it("maps matching DKT manifest to MiniCut ready", async () => {
		const storage = createMemoryDktStorage({
			manifest: {
				manifestVersion: 1,
				storageVersion: 1,
				schemaVersion: 1,
				appId: "minicut",
				profileId: "minicut-crdt-v1",
				schemaDictionaryMode: "none",
			},
		});

		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:ready",
		});

		expect(result).toMatchObject({ ok: true, status: "ready" });
	});

	it("maps newer DKT storage to a user-facing unsupported newer version reason", async () => {
		const storage = createMemoryDktStorage({
			manifest: {
				manifestVersion: 1,
				storageVersion: 2,
				schemaVersion: 1,
				appId: "minicut",
			},
		});

		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:newer",
		});

		expect(result).toMatchObject({
			ok: false,
			reason: "unsupported_newer_version",
		});
	});

	it("adopts legacy v0 DKT storage when schema exists", async () => {
		const storage = createMemoryDktStorage({ schema: { clip: {} } });

		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:legacy",
		});

		expect(result).toMatchObject({ ok: true, status: "adopted_v0" });
		expect(storage.readManifest()).toMatchObject({
			storageVersion: 1,
			schemaVersion: 1,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			adoptedFrom: "legacy_v0",
		});
		expect(storage.readMigrations()).toHaveLength(1);
	});
});
