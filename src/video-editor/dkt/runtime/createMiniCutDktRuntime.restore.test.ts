import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { describe, expect, it } from "vitest";
import {
	connectNodeHostTestWindow,
	findModels,
} from "../../adapters/node/testing/nodeHostDriver";
import { createEffectContractFakes } from "../test/effectContractFakes";
import { createMiniCutDktRuntime } from "./createMiniCutDktRuntime";

type MemoryStoragePackage = ReturnType<typeof makeDktCrdtMemoryStorage>;

/** Counts reads that only CRDT restore performs on the durable log. */
const withRestoreReadCounter = (storagePackage: MemoryStoragePackage) => {
	const counter = { reads: 0 };
	const crdtStorage = storagePackage.crdtStorage as {
		getBatchesAfter: (...args: unknown[]) => unknown;
	};
	const original = crdtStorage.getBatchesAfter.bind(crdtStorage);
	crdtStorage.getBatchesAfter = (...args: unknown[]) => {
		counter.reads += 1;
		return original(...args);
	};
	return counter;
};

const readStoredClock = async (storagePackage: MemoryStoragePackage) =>
	(
		storagePackage.crdtStorage as { getVectorClock: () => Promise<unknown> }
	).getVectorClock();

const createWebRuntime = (storagePackage: MemoryStoragePackage) =>
	createMiniCutDktRuntime({
		enabled: true,
		keepStorageOpenOnDisconnect: true,
		effectInterfaces: createEffectContractFakes().interfaces,
		crdt: {
			enabled: true,
			peerId: "restore-peer",
			workspaceIdForSessionKey: () => "restore-workspace",
			storage: storagePackage,
			transport: null,
		},
	});

/** Persists a project, then closes the seeding runtime; storage keeps its data. */
const seedStorage = async (storagePackage: MemoryStoragePackage): Promise<void> => {
	const seedRuntime = createWebRuntime(storagePackage);
	const seed = connectNodeHostTestWindow({ runtime: seedRuntime }, "seed-page");
	await seed.bootstrap();
	await seed.dispatchAndSettle("createProject", { title: "Kept project" });
	await (
		storagePackage as { commitChanges?: (meta?: unknown) => Promise<void> }
	).commitChanges?.({ reason: "seed" });
	await seedRuntime.dispose();
};

describe("CRDT storage restore belongs to runtime start", () => {
	it("a second page connection does not touch projects, durable log, outbox or clock", async () => {
		const storagePackage = makeDktCrdtMemoryStorage();
		await seedStorage(storagePackage);

		const runtime = createWebRuntime(storagePackage);
		const pageOne = connectNodeHostTestWindow({ runtime }, "page-one");
		await pageOne.bootstrap();
		await pageOne.dispatchAndSettle("createProject", { title: "Edited in page one" });
		const before = await pageOne.readDump();
		const clockBefore = await readStoredClock(storagePackage);

		const pageTwo = connectNodeHostTestWindow({ runtime }, "page-two");
		await pageTwo.bootstrap();
		const after = await pageOne.readDump();

		const titles = (dump: typeof after) =>
			findModels(dump, "project")
				.map((project) => project.attrs.title)
				.sort();
		expect(titles(before)).toContain("Kept project");
		expect(titles(after)).toEqual(titles(before));
		expect(after.crdt?.durableLogCount).toBe(before.crdt?.durableLogCount);
		expect(after.crdt?.outboxCount).toBe(before.crdt?.outboxCount);
		expect(await readStoredClock(storagePackage)).toEqual(clockBefore);
		expect(findModels(after, "session_root")).toHaveLength(
			findModels(before, "session_root").length + 1,
		);
		await runtime.dispose();
	});

	it("restores exactly once when two sessions connect concurrently during startup", async () => {
		const baselineStorage = makeDktCrdtMemoryStorage();
		await seedStorage(baselineStorage);
		const baselineReads = withRestoreReadCounter(baselineStorage);
		const baseline = createWebRuntime(baselineStorage);
		await baseline.start();
		const readsForOneStart = baselineReads.reads;
		expect(readsForOneStart).toBeGreaterThan(0);

		const storagePackage = makeDktCrdtMemoryStorage();
		await seedStorage(storagePackage);
		const reads = withRestoreReadCounter(storagePackage);
		const runtime = createWebRuntime(storagePackage);
		const pageOne = connectNodeHostTestWindow({ runtime }, "page-one");
		const pageTwo = connectNodeHostTestWindow({ runtime }, "page-two");
		await Promise.all([pageOne.bootstrap(), pageTwo.bootstrap()]);

		expect(reads.reads).toBe(readsForOneStart);
		await pageOne.dispatchAndSettle("createProject", { title: "Settle" });
		const dump = await pageOne.readDump();
		const sessionKeys = findModels(dump, "session_root").map(
			(root) => root.attrs.sessionKey,
		);
		expect(sessionKeys.filter((key) => key === "page-one")).toHaveLength(1);
		expect(sessionKeys.filter((key) => key === "page-two")).toHaveLength(1);
		await Promise.all([runtime.dispose(), baseline.dispose()]);
	});

	it("rejects start when restore fails, and dispose releases the storage", async () => {
		const storagePackage = makeDktCrdtMemoryStorage();
		await seedStorage(storagePackage);
		const crdtStorage = storagePackage.crdtStorage as {
			getBatchesAfter: () => Promise<unknown>;
		};
		crdtStorage.getBatchesAfter = () =>
			Promise.reject(new Error("restore read failed"));
		let closeCalls = 0;
		const originalClose = storagePackage.close?.bind(storagePackage);
		const closingPackage = {
			...storagePackage,
			close: async () => {
				closeCalls += 1;
				await originalClose?.();
			},
		} as MemoryStoragePackage;
		const runtime = createWebRuntime(closingPackage);

		await expect(runtime.start()).rejects.toThrow("restore read failed");
		await runtime.dispose();

		expect(closeCalls).toBe(1);
	});
});
