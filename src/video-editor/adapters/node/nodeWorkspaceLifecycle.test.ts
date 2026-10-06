import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEffectContractFakes } from "../../dkt/test/effectContractFakes";
import { createNodeLevelDbStoragePackage } from "./createNodeLevelDbStoragePackage";
import {
	getOrCreateNodeProfileIdentity,
	NodeProfileIdentityError,
} from "./nodeProfileIdentity";
import { NODE_PROFILE_METADATA_FILE_NAME } from "./nodeProfileLayout";
import { startNodeMiniCutHost, type NodeMiniCutHost } from "./startNodeMiniCutHost";
import {
	connectNodeHostTestWindow,
	findModels,
	type NodeHostTestDump,
} from "./testing/nodeHostDriver";

type CrdtStorageReader = {
	getVectorClock: () => Promise<Record<string, number> | null>;
	getBatchesAfter: (clock?: Record<string, number>) => Promise<{ batch_id: string }[]>;
	getBatchOutbox: () => Promise<{ batch_id: string }[]>;
};

type ManifestWriter = {
	putManifest: (manifest: unknown) => void;
};

type CrdtState = {
	clock: Record<string, number>;
	batchIds: string[];
	outboxIds: string[];
};

const readCrdtState = async (storagePath: string): Promise<CrdtState> => {
	const storagePackage = await createNodeLevelDbStoragePackage({ storagePath });
	try {
		const crdtStorage = storagePackage.crdtStorage as CrdtStorageReader;
		return {
			clock: (await crdtStorage.getVectorClock()) ?? {},
			batchIds: (await crdtStorage.getBatchesAfter({})).map((batch) => batch.batch_id),
			outboxIds: (await crdtStorage.getBatchOutbox()).map((batch) => batch.batch_id),
		};
	} finally {
		await storagePackage.close?.();
	}
};

const projectSummaries = (dump: NodeHostTestDump) =>
	findModels(dump, "project")
		.map((model) => ({ id: model.nodeId, title: model.attrs.title }))
		.sort((left, right) => String(left.id).localeCompare(String(right.id)));

const readFailure = async (promise: Promise<unknown>): Promise<unknown> =>
	promise.then(
		() => null,
		(reason: unknown) => reason,
	);

describe("Node workspace lifecycle on LevelDB", () => {
	let tempDir: string;
	let profileDir: string;
	const hosts: NodeMiniCutHost[] = [];

	const startHost = async () => {
		const host = await startNodeMiniCutHost({
			profileDir,
			effectInterfaces: createEffectContractFakes().interfaces,
		});
		hosts.push(host);
		return host;
	};

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-lifecycle-"));
		profileDir = path.join(tempDir, "profile");
	});

	afterEach(async () => {
		await Promise.all(hosts.splice(0).map((host) => host.dispose()));
		await rm(tempDir, { recursive: true, force: true });
	});

	const runTwoSessions = async () => {
		const first = await startHost();
		const firstWindow = connectNodeHostTestWindow(first);
		await firstWindow.bootstrap();
		await firstWindow.dispatchAndSettle("createProject", { title: "Kept project" });
		const beforeClose = await firstWindow.readDump();
		await first.dispose();
		const stateAfterFirstRun = await readCrdtState(first.identity.storagePath);

		const second = await startHost();
		const secondWindow = connectNodeHostTestWindow(second);
		await secondWindow.bootstrap();
		const afterReopen = await secondWindow.readDump();
		await secondWindow.dispatchAndSettle("createProject", { title: "After restore" });
		const afterNextEdit = await secondWindow.readDump();
		await second.dispose();
		const stateAfterSecondRun = await readCrdtState(second.identity.storagePath);
		return {
			first,
			second,
			beforeClose,
			afterReopen,
			afterNextEdit,
			stateAfterFirstRun,
			stateAfterSecondRun,
		};
	};

	it("restores graph, CRDT state and identity after close and reopen, then continues the clock", async () => {
		const run = await runTwoSessions();
		const peerId = run.first.identity.peerId;

		expect(run.second.identity).toEqual({ ...run.first.identity, created: false });
		expect(projectSummaries(run.afterReopen)).toEqual(
			projectSummaries(run.beforeClose),
		);
		expect(
			projectSummaries(run.afterReopen).map((project) => project.title),
		).toContain("Kept project");
		expect(run.afterReopen.crdt).toMatchObject({
			enabled: true,
			peerId,
			durableLogCount: run.beforeClose.crdt?.durableLogCount,
			outboxCount: run.beforeClose.crdt?.outboxCount,
		});
		expect(
			projectSummaries(run.afterNextEdit).map((project) => project.title),
		).toEqual(expect.arrayContaining(["Kept project", "After restore"]));
		expect(run.afterNextEdit.crdt?.durableLogCount).toBeGreaterThan(
			run.afterReopen.crdt?.durableLogCount ?? 0,
		);
		expect(Object.keys(run.stateAfterFirstRun.clock)).toEqual([peerId]);
		expect(run.stateAfterSecondRun.clock[peerId]).toBeGreaterThan(
			run.stateAfterFirstRun.clock[peerId] ?? 0,
		);
	});

	it("keeps earlier durable log batches and outbox entries after a restart", async () => {
		const run = await runTwoSessions();

		expect(
			run.stateAfterSecondRun.batchIds.slice(0, run.stateAfterFirstRun.batchIds.length),
		).toEqual(run.stateAfterFirstRun.batchIds);
		expect(run.stateAfterSecondRun.batchIds.length).toBeGreaterThan(
			run.stateAfterFirstRun.batchIds.length,
		);
		expect(new Set(run.stateAfterSecondRun.batchIds).size).toBe(
			run.stateAfterSecondRun.batchIds.length,
		);
		expect(run.stateAfterSecondRun.outboxIds).toEqual(
			expect.arrayContaining(run.stateAfterFirstRun.outboxIds),
		);
		expect(run.stateAfterSecondRun.outboxIds.length).toBeGreaterThan(
			run.stateAfterFirstRun.outboxIds.length,
		);
	});

	it("shares one runtime, actor and state between two windows", async () => {
		const host = await startHost();
		const firstWindow = connectNodeHostTestWindow(host, "window-a");
		const secondWindow = connectNodeHostTestWindow(host, "window-b");
		await firstWindow.bootstrap();
		await secondWindow.bootstrap();

		await firstWindow.dispatchAndSettle("createProject", { title: "Shared" });
		const seenBySecond = await secondWindow.readDump();

		expect(projectSummaries(seenBySecond).map((project) => project.title)).toContain(
			"Shared",
		);
		expect(seenBySecond.crdt?.peerId).toBe(host.identity.peerId);
	});

	it("fails startup for a newer workspace manifest without changing storage", async () => {
		const identity = await getOrCreateNodeProfileIdentity({ profileDir });
		const seeded = await createNodeLevelDbStoragePackage({
			storagePath: identity.storagePath,
		});
		(seeded.dktStorage as ManifestWriter).putManifest({
			manifestVersion: 1,
			storageVersion: 99,
			schemaVersion: 1,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			schemaDictionaryMode: "none",
			workspaceId: identity.workspaceId,
		});
		await seeded.commitChanges?.({ reason: "seed-newer-manifest" });
		await seeded.close?.();

		const error = await readFailure(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: createEffectContractFakes().interfaces,
			}),
		);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("unsupported newer version");
		const afterFailure = await readCrdtState(identity.storagePath);
		expect(afterFailure.batchIds).toEqual([]);
	});

	it("fails startup for a manifest of another workspace", async () => {
		const identity = await getOrCreateNodeProfileIdentity({ profileDir });
		const seeded = await createNodeLevelDbStoragePackage({
			storagePath: identity.storagePath,
		});
		(seeded.dktStorage as ManifestWriter).putManifest({
			manifestVersion: 1,
			storageVersion: 2,
			schemaVersion: 1,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			schemaDictionaryMode: "plain-string-to-number",
			workspaceId: "harness:room:someone-else",
		});
		await seeded.commitChanges?.({ reason: "seed-foreign-manifest" });
		await seeded.close?.();

		const error = await readFailure(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: createEffectContractFakes().interfaces,
			}),
		);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("incompatible");
	});

	it("releases the database after a failed startup", async () => {
		const identity = await getOrCreateNodeProfileIdentity({ profileDir });
		const seeded = await createNodeLevelDbStoragePackage({
			storagePath: identity.storagePath,
		});
		(seeded.dktStorage as ManifestWriter).putManifest({
			manifestVersion: 1,
			storageVersion: 99,
			schemaVersion: 1,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			schemaDictionaryMode: "none",
			workspaceId: identity.workspaceId,
		});
		await seeded.commitChanges?.({ reason: "seed-newer-manifest" });
		await seeded.close?.();
		await readFailure(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: createEffectContractFakes().interfaces,
			}),
		);

		const reopened = await createNodeLevelDbStoragePackage({
			storagePath: identity.storagePath,
		});

		await reopened.close?.();
	});

	it("does not create an empty project when the database is owned by another process", async () => {
		const identity = await getOrCreateNodeProfileIdentity({ profileDir });
		const owner = await createNodeLevelDbStoragePackage({
			storagePath: identity.storagePath,
		});
		try {
			const error = await readFailure(
				startNodeMiniCutHost({
					profileDir,
					effectInterfaces: createEffectContractFakes().interfaces,
				}),
			);

			expect((error as Error).name).toBe("NodeLevelDbStorageOpenError");
		} finally {
			await owner.close?.();
		}
		const state = await readCrdtState(identity.storagePath);
		expect(state.batchIds).toEqual([]);
	});

	it("does not create a workspace when profile metadata is corrupted", async () => {
		await mkdir(profileDir, { recursive: true });
		await writeFile(path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME), "{", "utf8");

		const error = await readFailure(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: createEffectContractFakes().interfaces,
			}),
		);

		expect(error).toBeInstanceOf(NodeProfileIdentityError);
		await expect(stat(path.join(profileDir, "workspaces"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
