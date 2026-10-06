import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { describe, expect, it } from "vitest";
import { createMiniCutDktRuntime } from "./createMiniCutDktRuntime";

const createCountingStorage = () => {
	const storagePackage = makeDktCrdtMemoryStorage();
	let closeCalls = 0;
	const originalClose = storagePackage.close?.bind(storagePackage);
	return {
		storagePackage: {
			...storagePackage,
			close: async () => {
				closeCalls += 1;
				await originalClose?.();
			},
		},
		closeCalls: () => closeCalls,
	};
};

const createRuntime = (storage: ReturnType<typeof createCountingStorage>) =>
	createMiniCutDktRuntime({
		enabled: true,
		keepStorageOpenOnDisconnect: true,
		crdt: {
			enabled: true,
			peerId: "lifecycle-peer",
			storage: storage.storagePackage,
			transport: null,
		},
	});

describe("createMiniCutDktRuntime lifecycle", () => {
	it("starts explicitly and closes storage once on repeated dispose", async () => {
		const storage = createCountingStorage();
		const runtime = createRuntime(storage);

		await runtime.start();
		expect(storage.closeCalls()).toBe(0);

		await Promise.all([runtime.dispose(), runtime.dispose()]);
		await runtime.dispose();

		expect(storage.closeCalls()).toBe(1);
	});

	it("rejects start and connect after dispose", async () => {
		const storage = createCountingStorage();
		const runtime = createRuntime(storage);
		await runtime.start();
		await runtime.dispose();

		await expect(runtime.start()).rejects.toThrow("disposed");
		expect(() =>
			runtime.connect({
				send: () => {},
				listen: () => () => {},
				destroy: () => {},
			}),
		).toThrow("disposed");
	});

	it("disposes a runtime that was never started", async () => {
		const storage = createCountingStorage();
		const runtime = createRuntime(storage);

		await runtime.dispose();

		expect(storage.closeCalls()).toBe(0);
	});

	it("keeps storage open when the last connection leaves and keepStorageOpenOnDisconnect is set", async () => {
		const storage = createCountingStorage();
		const runtime = createRuntime(storage);
		await runtime.start();
		const connection = runtime.connect({
			send: () => {},
			listen: () => () => {},
			destroy: () => {},
		});

		connection.destroy();
		await runtime.dispose();

		expect(storage.closeCalls()).toBe(1);
	});

	it("disposes while start is still in flight", async () => {
		const storage = createCountingStorage();
		const runtime = createRuntime(storage);

		const started = runtime.start().then(
			() => "started",
			() => "rejected",
		);
		await runtime.dispose();
		const outcome = await started;

		expect(["started", "rejected"]).toContain(outcome);
		expect(storage.closeCalls()).toBe(1);
		await expect(runtime.start()).rejects.toThrow("disposed");
	});

	it("closes storage when the last connection leaves by default (browser worker behaviour)", async () => {
		const storage = createCountingStorage();
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				peerId: "lifecycle-peer",
				storage: storage.storagePackage,
				transport: null,
			},
		});
		await runtime.start();
		let transportDestroyed: () => void = () => {};
		const destroyed = new Promise<void>((resolve) => {
			transportDestroyed = resolve;
		});
		const connection = runtime.connect({
			send: () => {},
			listen: () => () => {},
			destroy: () => transportDestroyed(),
		});

		connection.destroy();
		await destroyed;

		expect(storage.closeCalls()).toBe(1);
	});
});
