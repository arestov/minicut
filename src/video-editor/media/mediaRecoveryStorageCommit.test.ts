import type { AcceptedPublication } from "./mediaPublicationProtocol";
import { describe, expect, it, vi } from "vitest";
import { commitRecoveryStorage, type RecoveryPublishOutcome, type RecoveryStorageFaultPoint } from "./mediaRecoveryStorageCommit";

const fixture = (assetFailure?: "quota-exceeded" | "unavailable" | "storage-error") => {
	const versions = new Set<string>(); const handles = new Set<string>(); const cleanup = vi.fn();
const file = new File(["x"], "x.mp4", { type: "video/mp4", lastModified: 1 });
	const assets = { protectPublicationResource: vi.fn(),
		stage: vi.fn(async (_p: string, _r: string, op: string) => assetFailure ? { ok: false as const, reason: assetFailure } : (versions.add(`project/p/resource/r/asset/${op}`), { ok: true as const, assetRef: `project/p/resource/r/asset/${op}` })),
		validate: vi.fn(async (ref: string) => versions.has(ref)), rollback: vi.fn(async (ref: string) => { versions.delete(ref); }), cleanup,
	} as never;
	const handleStore = { protectPublicationResource: vi.fn(),
		stage: vi.fn(async (_p: string, _r: string, op: string) => { const ref = `project/p/resource/r/handle/${op}`; handles.add(ref); return ref; }),
		validate: vi.fn(async (ref: string) => handles.has(ref)), rollback: vi.fn(async (ref: string) => { handles.delete(ref); }), cleanup: vi.fn(),
	};
	const pointer = { assetStorageKind: assetFailure ? "linked" as const : "project-copy" as const, assetRef: assetFailure ? null : "project/p/resource/r/asset/op", sourceKind: "file-handle", sourceRef: "project/p/resource/r/handle/op", url: "blob:playback", contentFingerprint: "fp", fingerprintVersion: "v1", duration: 1, width: null, height: null, localMediaAvailability: assetFailure ? "ready-file-handle" : "ready-project-copy", originalAccessStatus: "granted" };
	const candidateFileMetadata = { mime: file.type, size: file.size, lastModified: file.lastModified };
	const receipt: AcceptedPublication = { projectId: "p", resourceId: "r", taskId: "t", operationId: "op", attemptId: "attempt", bootId: "boot", runtimeHandleId: "runtime", candidateMetadata: { kind: "video", duration: 1 }, candidateFingerprint: "fp", candidateFingerprintVersion: "v1", pointer, candidateFileMetadata, updatedAt: 1, kind: "accepted", sequence: 1, previousAcceptedIdentityAndRefs: null, acceptedResource: { projectId: "p", resourceId: "r", name: "kept", kind: "video", status: "ready", source: { kind: "local" }, data: {}, ...pointer, ...candidateFileMetadata } };
	const applied = async (): Promise<RecoveryPublishOutcome> => ({ kind: "accepted", receipt });
	const run = (publish: () => Promise<RecoveryPublishOutcome> = applied, point?: RecoveryStorageFaultPoint) => commitRecoveryStorage({ projectId: "p", resourceId: "r", operationId: "op", file, handleRecord: { resourceId: "r", handle: {} as FileSystemFileHandle, name: "x.mp4", size: 1, lastModified: 1, mime: "video/mp4", createdAt: 1, updatedAt: 1 }, assetMetadata: {}, assets, handles: handleStore as never, publish, fault: point ? (at) => { if (at === point) throw new Error(point); } : undefined });
	return { run, receipt, assets: assets as unknown as { protectPublicationResource: ReturnType<typeof vi.fn> }, handleStore, versions, handles, cleanup };
};

describe("recovery storage commit", () => {
	for (const point of ["before-stage", "after-asset-stage", "after-handle-stage", "after-validation"] as const) {
		it(`rolls back unpublished data on ${point}`, async () => { const f = fixture(); expect((await f.run(undefined, point)).ok).toBe(false); expect(f.versions.size).toBe(0); expect(f.handles.size).toBe(0); });
	}
	it("rolls back both versions when DKT completion is stale", async () => { const f = fixture(); expect(await f.run(vi.fn(async () => ({ kind: "rejected" as const, candidateDisposition: "rollback-unaccepted" as const })))).toMatchObject({ ok: false, reason: "stale" }); expect(f.versions.size).toBe(0); expect(f.handles.size).toBe(0); });
	it("leaves the published version for boot reconciliation after a post-switch crash", async () => { const f = fixture(); expect(await f.run(undefined, "after-pointer-switch")).toMatchObject({ ok: true, publication: { kind: "accepted" } }); expect(f.versions.size).toBe(1); expect(f.handles.size).toBe(1); expect(f.cleanup).not.toHaveBeenCalled(); });
	it.each(["quota-exceeded", "unavailable"] as const)("publishes a linked fallback on %s", async (reason) => { const f = fixture(reason); const publish = vi.fn(async () => ({ kind: "indeterminate" as const, reason: "ack-only" })); expect(await f.run(publish)).toMatchObject({ ok: true, assetRef: null, linkedFallback: true }); expect(publish).toHaveBeenCalledWith(expect.objectContaining({ assetRef: null, linkedFallback: true })); });
	it("does not use linked fallback for an unexpected asset error", async () => { const f = fixture("storage-error"); expect(await f.run()).toMatchObject({ ok: false, reason: "asset-stage" }); expect(f.handleStore.stage).not.toHaveBeenCalled(); });
	it("publishes a project copy when the imported File has no persistent handle", async () => {
		const assets = { protectPublicationResource: vi.fn(),
			stage: vi.fn(async () => ({ ok: true as const, assetRef: "project/p/resource/r/asset/op" })),
			validate: vi.fn(async () => true),
			rollback: vi.fn(),
			cleanup: vi.fn(),
		} as never;
		const handles = { protectPublicationResource: vi.fn(),
			stage: vi.fn(),
			validate: vi.fn(),
			rollback: vi.fn(),
			cleanup: vi.fn(),
		} as never;
		const publish = vi.fn(async () => ({ kind: "indeterminate" as const, reason: "ack-only" }));

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

describe("publication dispatch uncertainty", () => {
	it.each(["ack-only", "throw-after-dispatch", "retained-rejection"] as const)("S1 retains exact staged refs for %s", async (mode) => {
		const f = fixture();
		const result = await f.run(async () => {
			if (mode === "throw-after-dispatch") throw new Error("lost dispatch receipt");
			if (mode === "retained-rejection") return { kind: "rejected", candidateDisposition: "retain-uncertain" };
			return { kind: "indeterminate", reason: "technical ACK without decision" };
		});
		expect(result.ok).toBe(true);
		expect(f.versions).toEqual(new Set(["project/p/resource/r/asset/op"]));
		expect(f.handles).toEqual(new Set(["project/p/resource/r/handle/op"]));
		expect(f.cleanup).not.toHaveBeenCalled();
	});
	it("protects ownership before the first asynchronous staging boundary", async () => {
		const f = fixture();
		await f.run();
		expect(f.assets.protectPublicationResource).toHaveBeenCalledWith("p", "r");
		expect(f.handleStore.protectPublicationResource).toHaveBeenCalledWith("r");
	});
});
describe("semantic receipt before technical acknowledgement", () => {
	it("S1 retains staged versions while ACK is pending and keeps the already received acceptance", async () => {
		const f = fixture(); let releaseAck!: () => void; let entered!: () => void;
		const ack = new Promise<void>((resolve) => { releaseAck = resolve; });
		const publishing = new Promise<void>((resolve) => { entered = resolve; });
		const pending = f.run(async () => { const received = f.receipt; entered(); await ack; return { kind: "accepted", receipt: received }; });
		await publishing;
		expect(f.versions.size).toBe(1); expect(f.handles.size).toBe(1);
		expect(f.cleanup).not.toHaveBeenCalled();
		releaseAck();
		expect(await pending).toMatchObject({ ok: true, publication: { kind: "accepted", receipt: f.receipt } });
		expect(f.versions.size).toBe(1); expect(f.handles.size).toBe(1);
	});
});
