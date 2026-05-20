import { describe, expect, it } from "vitest";
import {
	WORKSPACE_OPEN_FAILURE,
	WORKSPACE_OPEN_STATUS,
} from "../runtime/workspaceOpenState";
import {
	createMiniCutExpectedManifest,
	createMiniCutHarnessDbName,
	createMiniCutHarnessWorkspaceId,
	createMiniCutRoomPeerId,
	createMiniCutStoredDktManifest,
	createMiniCutWorkspaceDbName,
	openMiniCutWorkspaceStorage,
	readRoomIdFromMiniCutHarnessWorkspaceId,
	stageMiniCutWorkspaceManifest,
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

	it("derives CRDT peer ids from workspace ids and local identities", () => {
		const workspaceId = createMiniCutHarnessWorkspaceId("room alpha/1");
		expect(createMiniCutRoomPeerId(workspaceId, "local-a")).toBe(
			createMiniCutRoomPeerId(workspaceId, "local-a"),
		);
		expect(createMiniCutRoomPeerId(workspaceId, "local-a")).toMatch(
			/^minicut-peer:local-a:[0-9a-f]{8}$/,
		);
		expect(createMiniCutRoomPeerId(workspaceId, "local-a")).not.toBe(
			createMiniCutRoomPeerId(workspaceId, "local-b"),
		);
		expect(createMiniCutRoomPeerId(workspaceId, "local-a")).not.toBe(
			createMiniCutRoomPeerId(createMiniCutHarnessWorkspaceId("room beta/1"), "local-a"),
		);
	});

	it("maps empty DKT storage to MiniCut empty-initialized without writing initial graph", async () => {
		const storage = createMemoryDktStorage();
		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:empty",
		});

		expect(result).toMatchObject({
			ok: true,
			status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
			statusLabel: "empty_initialized",
			sourceStatus: "empty",
			openState: {
				status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
				failureReason: WORKSPACE_OPEN_FAILURE.NONE,
			},
		});
		expect(storage.readManifest()).toBeNull();
	});

	it("maps matching DKT manifest to MiniCut ready", async () => {
		const storage = createMemoryDktStorage({
			manifest: createMiniCutStoredDktManifest("harness:room:ready"),
		});

		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:ready",
		});

		expect(result).toMatchObject({
			ok: true,
			status: WORKSPACE_OPEN_STATUS.READY,
			statusLabel: "ready",
			sourceStatus: "ready",
			openState: {
				status: WORKSPACE_OPEN_STATUS.READY,
				failureReason: WORKSPACE_OPEN_FAILURE.NONE,
			},
		});
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
			status: WORKSPACE_OPEN_STATUS.FAILED,
			failureReason: WORKSPACE_OPEN_FAILURE.UNSUPPORTED_NEWER_VERSION,
			failureReasonLabel: "unsupported_newer_version",
		});
	});

	it("treats a mismatched stored workspace id as incompatible", async () => {
		const storage = createMemoryDktStorage({
			manifest: createMiniCutStoredDktManifest("harness:room:other"),
		});

		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:expected",
		});

		expect(result).toMatchObject({
			ok: false,
			status: WORKSPACE_OPEN_STATUS.FAILED,
			failureReason: WORKSPACE_OPEN_FAILURE.INCOMPATIBLE,
			failureReasonLabel: "incompatible",
		});
	});

	it("adopts legacy v0 DKT storage when schema exists", async () => {
		const storage = createMemoryDktStorage({ schema: { clip: {} } });

		const result = await openMiniCutWorkspaceStorage({
			storage,
			workspaceId: "harness:room:legacy",
		});

		expect(result).toMatchObject({
			ok: true,
			status: WORKSPACE_OPEN_STATUS.READY,
			sourceStatus: "adopted_v0",
		});
		expect(storage.readManifest()).toMatchObject({
			storageVersion: 1,
			schemaVersion: 1,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			adoptedFrom: "legacy_v0",
		});
		expect(storage.readMigrations()).toHaveLength(1);
	});

	it("stages a stored DKT manifest for empty workspaces", () => {
		const storage = createMemoryDktStorage();
		const staged = stageMiniCutWorkspaceManifest({
			storage,
			workspaceId: "harness:room:stage",
		});

		expect(staged).toMatchObject({
			workspaceId: "harness:room:stage",
			storageVersion: 1,
			schemaVersion: 1,
			profileId: "minicut-crdt-v1",
		});
		expect(storage.readManifest()).toMatchObject({
			workspaceId: "harness:room:stage",
		});
	});
});
