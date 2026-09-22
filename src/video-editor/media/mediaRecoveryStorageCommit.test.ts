import { describe, expect, it, vi } from "vitest";
import { commitRecoveryStorage, type RecoveryPublishOutcome, type RecoveryStorageFaultPoint } from "./mediaRecoveryStorageCommit";

const fixture = (assetFailure?: "quota-exceeded" | "unavailable" | "storage-error") => {
	const versions = new Set<string>(); const handles = new Set<string>(); const cleanup = vi.fn();
	const assets = {
		stage: vi.fn(async (_p: string, _r: string, op: string) => assetFailure ? { ok: false as const, reason: assetFailure } : (versions.add(`project/p/resource/r/asset/${op}`), { ok: true as const, assetRef: `project/p/resource/r/asset/${op}` })),
		validate: vi.fn(async (ref: string) => versions.has(ref)), rollback: vi.fn(async (ref: string) => { versions.delete(ref); }), cleanup,
	} as never;
	const handleStore = {
		stage: vi.fn(async (_p: string, _r: string, op: string) => { const ref = `project/p/resource/r/handle/${op}`; handles.add(ref); return ref; }),
		validate: vi.fn(async (ref: string) => handles.has(ref)), rollback: vi.fn(async (ref: string) => { handles.delete(ref); }), cleanup: vi.fn(),
	};
	const applied = async (): Promise<RecoveryPublishOutcome> => "applied";
	const run = (publish: () => Promise<RecoveryPublishOutcome> = applied, point?: RecoveryStorageFaultPoint) => commitRecoveryStorage({ projectId: "p", resourceId: "r", operationId: "op", file: new File(["x"], "x.mp4"), handleRecord: { resourceId: "r", handle: {} as FileSystemFileHandle, name: "x.mp4", size: 1, lastModified: 1, mime: "video/mp4", createdAt: 1, updatedAt: 1 }, assetMetadata: {}, assets, handles: handleStore as never, publish, fault: point ? (at) => { if (at === point) throw new Error(point); } : undefined });
	return { run, assets, handleStore, versions, handles, cleanup };
};

describe("recovery storage commit", () => {
	for (const point of ["before-stage", "after-asset-stage", "after-handle-stage", "after-validation"] as const) {
		it(`rolls back unpublished data on ${point}`, async () => { const f = fixture(); expect((await f.run(undefined, point)).ok).toBe(false); expect(f.versions.size).toBe(0); expect(f.handles.size).toBe(0); });
	}
	it("rolls back both versions when DKT completion is stale", async () => { const f = fixture(); expect(await f.run(vi.fn(async () => "noop" as const))).toMatchObject({ ok: false, reason: "stale" }); expect(f.versions.size).toBe(0); expect(f.handles.size).toBe(0); });
	it("leaves the published version for boot reconciliation after a post-switch crash", async () => { const f = fixture(); expect(await f.run(undefined, "after-pointer-switch")).toMatchObject({ ok: false, reason: "interrupted" }); expect(f.versions.size).toBe(1); expect(f.handles.size).toBe(1); expect(f.cleanup).not.toHaveBeenCalled(); });
	it.each(["quota-exceeded", "unavailable"] as const)("publishes a linked fallback on %s", async (reason) => { const f = fixture(reason); const publish = vi.fn(async () => "applied" as const); expect(await f.run(publish)).toMatchObject({ ok: true, assetRef: null, linkedFallback: true }); expect(publish).toHaveBeenCalledWith(expect.objectContaining({ assetRef: null, linkedFallback: true })); });
	it("does not use linked fallback for an unexpected asset error", async () => { const f = fixture("storage-error"); expect(await f.run()).toMatchObject({ ok: false, reason: "asset-stage" }); expect(f.handleStore.stage).not.toHaveBeenCalled(); });
	it("publishes a project copy when the imported File has no persistent handle", async () => {
		const assets = {
			stage: vi.fn(async () => ({ ok: true as const, assetRef: "project/p/resource/r/asset/op" })),
			validate: vi.fn(async () => true),
			rollback: vi.fn(),
			cleanup: vi.fn(),
		} as never;
		const handles = {
			stage: vi.fn(),
			validate: vi.fn(),
			rollback: vi.fn(),
			cleanup: vi.fn(),
		} as never;
		const publish = vi.fn(async () => "applied" as const);

		const result = await commitRecoveryStorage({
			projectId: "p",
			resourceId: "r",
			operationId: "op",
			file: new File(["x"], "x.webm"),
			handleRecord: null,
			assetMetadata: {},
			assets,
			handles,
			publish,
		});

		expect(result).toMatchObject({
			ok: true,
			assetRef: "project/p/resource/r/asset/op",
			handleRef: null,
		});
		expect(handles.stage).not.toHaveBeenCalled();
		expect(publish).toHaveBeenCalledWith(
			expect.objectContaining({ handleRef: null }),
		);
	});
});
