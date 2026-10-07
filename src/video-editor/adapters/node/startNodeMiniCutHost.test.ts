import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEffectContractFakes } from "../../dkt/test/effectContractFakes";
import { createNodeLevelDbStoragePackage } from "./createNodeLevelDbStoragePackage";
import { runDktStorageRequest, type DktStorageRequest } from "../../dkt/storage/dktStorageRequest";
import { startNodeMiniCutHost, type NodeMiniCutHost } from "./startNodeMiniCutHost";
import {
	connectNodeHostTestWindow,
	findModels,
} from "./testing/nodeHostDriver";

type StorageOpener = NonNullable<
	Parameters<typeof startNodeMiniCutHost>[0]["openStorage"]
>;

/** Wraps selected members of a storage object; everything else is delegated. */
const overrideMembers = <T extends object>(
	target: T,
	overrides: Record<string, (...args: never[]) => unknown>,
): T =>
	new Proxy(target, {
		get(object, key) {
			if (typeof key === "string" && key in overrides) {
				return overrides[key];
			}
			const value = Reflect.get(object, key);
			return typeof value === "function" ? value.bind(object) : value;
		},
	});

const openWithOverrides =
	(
		pick: "package" | "dktStorage",
		overrides: Record<string, (...args: never[]) => unknown>,
	): StorageOpener =>
	async (options) => {
		const real = await createNodeLevelDbStoragePackage(options);
		return pick === "package"
			? overrideMembers(real, overrides)
			: { ...real, dktStorage: overrideMembers(real.dktStorage as object, overrides) };
	};

describe("startNodeMiniCutHost", () => {
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
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-node-host-"));
		profileDir = path.join(tempDir, "profile");
	});

	afterEach(async () => {
		await Promise.all(hosts.splice(0).map((host) => host.dispose()));
		await rm(tempDir, { recursive: true, force: true });
	});

	it("runs the local CRDT engine with the saved peerId and no network transport", async () => {
		const host = await startHost();
		const window = connectNodeHostTestWindow(host);
		await window.bootstrap();

		const dump = await window.readDump();

		expect(dump.crdt).toMatchObject({
			enabled: true,
			peerId: host.identity.peerId,
			hasRegistry: true,
		});
		// Local ops (e.g. the default project) are traced, network events must not exist.
		const trace = (dump.crdt?.transportTrace ?? []) as Array<{ event?: string }>;
		expect(trace.filter((entry) => !entry.event?.startsWith("local:"))).toEqual([]);
	});

	it("writes CRDT outbox and durable log entries for local edits without a transport", async () => {
		const host = await startHost();
		const window = connectNodeHostTestWindow(host);
		await window.bootstrap();
		const before = await window.readDump();

		await window.dispatchAndSettle("createProject", { title: "Local only" });
		const after = await window.readDump();

		expect(findModels(after, "project").length).toBeGreaterThan(
			findModels(before, "project").length,
		);
		expect(after.crdt?.outboxCount).toBeGreaterThan(before.crdt?.outboxCount ?? 0);
		expect(after.crdt?.durableLogCount).toBeGreaterThan(
			before.crdt?.durableLogCount ?? 0,
		);
	});

	it("rejects an incomplete effect interface set before touching the profile", async () => {
		await expect(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: {} as never,
			}),
		).rejects.toThrow();
		await expect(stat(profileDir)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("disposes idempotently and refuses new windows afterwards", async () => {
		const host = await startHost();

		await Promise.all([host.dispose(), host.dispose()]);
		await host.dispose();

		expect(() => connectNodeHostTestWindow(host)).toThrow("disposed");
	});

	it("releases LevelDB and rethrows the first error when runtime dispose fails", async () => {
		const failure = new Error("runtime dispose failed");
		const host = await startNodeMiniCutHost({
			profileDir,
			effectInterfaces: createEffectContractFakes().interfaces,
			openStorage: openWithOverrides("package", {
				whenReady: () => Promise.reject(failure),
			}),
		});

		await expect(host.dispose()).rejects.toBe(failure);

		const reopened = await createNodeLevelDbStoragePackage({
			storagePath: host.identity.storagePath,
		});
		await reopened.close?.();
	});

	it("releases LevelDB when start fails while restoring an existing workspace", async () => {
		const first = await startHost();
		await first.dispose();
		const failure = new Error("snapshot unreadable");

		await expect(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: createEffectContractFakes().interfaces,
				openStorage: openWithOverrides("dktStorage", {
					getSnapshot: (done: (error: unknown) => void) => done(failure),
				}),
			}),
		).rejects.toThrow("snapshot unreadable");

		const reopened = await createNodeLevelDbStoragePackage({
			storagePath: first.identity.storagePath,
		});
		await reopened.close?.();
	});

	it("releases LevelDB when start fails on a new workspace", async () => {
		let storagePath = "";
		await expect(
			startNodeMiniCutHost({
				profileDir,
				effectInterfaces: createEffectContractFakes().interfaces,
				openStorage: async (options) => {
					storagePath = options.storagePath;
					return openWithOverrides("dktStorage", {
						putSchema: () => {
							throw new Error("schema write failed");
						},
					})(options);
				},
			}),
		).rejects.toThrow("schema write failed");

		const reopened = await createNodeLevelDbStoragePackage({ storagePath });
		await reopened.close?.();
	});

	it("does not persist a workspace manifest when the first start fails", async () => {
		let storagePath = "";
		await startNodeMiniCutHost({
			profileDir,
			effectInterfaces: createEffectContractFakes().interfaces,
			openStorage: async (options) => {
				storagePath = options.storagePath;
				return openWithOverrides("dktStorage", {
					putSchema: () => {
						throw new Error("schema write failed");
					},
				})(options);
			},
		}).catch(() => undefined);

		const inspected = await createNodeLevelDbStoragePackage({ storagePath });
		try {
			const manifest = await runDktStorageRequest(
				(inspected.dktStorage as { getManifest: DktStorageRequest<unknown> })
					.getManifest,
			);
			expect(manifest ?? null).toBeNull();
		} finally {
			await inspected.close?.();
		}
	});
});
