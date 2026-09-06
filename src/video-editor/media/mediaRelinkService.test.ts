import { describe, expect, it, vi } from "vitest";
import { createMediaRelinkService } from "./mediaRelinkService";
import type { MediaTechnicalMetadata } from "./mediaRelinkPolicy";

const metadata = (duration = 10): MediaTechnicalMetadata => ({ kind: "video", duration, frameRate: 30, timebase: 1 / 30, width: 1920, height: 1080, audioChannels: 2, audioSampleRate: 48_000, streams: { videoStreams: 1, audioStreams: 1 } });
const candidate = (same: boolean, text = "new") => ({
	getFile: vi.fn(async () => new File([text], "clip.webm", { type: "video/webm", lastModified: 2 })),
	isSameEntry: vi.fn(async () => same),
}) as never;
const setup = (options: { duration?: number; fingerprint?: string; completeFails?: boolean; assetFails?: boolean } = {}) => {
	let handleRecord: any = { resourceId: "r1", handle: {}, name: "old", size: 3, lastModified: 1, mime: "video/webm", createdAt: 1, updatedAt: 1 };
	let asset = new File(["old"], "old.webm");
	const activate = vi.fn();
	const deps = {
		handles: { get: vi.fn(async () => handleRecord), put: vi.fn(async (record) => { handleRecord = record; }), delete: vi.fn(async () => { handleRecord = null; }) },
		assets: {
			getFile: vi.fn(async () => asset),
			putFromFile: vi.fn(async (_p, _r, file) => { if (options.assetFails) return { ok: false as const, reason: "storage-error" as const }; asset = file; return { ok: true as const, assetRef: "p1/r1" }; }),
			deleteResource: vi.fn(async () => { asset = null as never; }),
		} as never,
		probe: vi.fn(async () => metadata(options.duration ?? 10)),
		fingerprint: vi.fn(async () => ({ fingerprint: options.fingerprint ?? "old-fp", version: "sha256-v1" })),
		createObjectUrl: vi.fn(() => "blob:new"),
		revokeObjectUrl: vi.fn(),
		complete: vi.fn(async () => { if (options.completeFails) throw new Error("DKT failed"); }),
		activate,
		now: () => 2,
	};
	return { service: createMediaRelinkService(deps), deps, activate, getHandle: () => handleRecord, getAsset: () => asset };
};

describe("mediaRelinkService", () => {
	it("commits exact same-entry without confirmation", async () => {
		const { service, activate } = setup();
		const inspected = await service.inspectRelinkCandidate({ resourceId: "r1", projectId: "p1", intent: "locate-original", original: metadata(), requiredSourceEnd: 9, originalFingerprint: "old-fp", fingerprintVersion: "sha256-v1", candidateHandle: candidate(true), operationId: "op1" });
		expect(inspected.policy.classification).toBe("exact-match");
		expect(await service.commitResourceRelink("op1")).toEqual({ ok: true });
		expect(activate).toHaveBeenCalledOnce();
	});

	it("requires confirmation for a different compatible replacement", async () => {
		const { service } = setup({ fingerprint: "different" });
		const inspected = await service.inspectRelinkCandidate({ resourceId: "r1", projectId: "p1", intent: "replace-source", original: metadata(), requiredSourceEnd: 9, originalFingerprint: "old-fp", fingerprintVersion: "sha256-v1", candidateHandle: candidate(false), operationId: "op2" });
		expect(inspected.policy.classification).toBe("compatible-replacement");
		expect(await service.commitResourceRelink("op2")).toEqual({ ok: false, reason: "confirmation-required" });
		expect(await service.commitResourceRelink("op2", inspected.confirmationToken!)).toEqual({ ok: true });
	});

	it("rejects a candidate shorter than required source range before writes", async () => {
		const { service, deps } = setup({ duration: 5 });
		const inspected = await service.inspectRelinkCandidate({ resourceId: "r1", projectId: "p1", intent: "replace-source", original: metadata(), requiredSourceEnd: 8, candidateHandle: candidate(false), operationId: "op3" });
		expect(inspected.policy.classification).toBe("incompatible");
		expect(await service.commitResourceRelink("op3")).toEqual({ ok: false, reason: "incompatible" });
		expect(deps.handles.put).not.toHaveBeenCalled();
	});

	it("rolls back the old handle and asset when DKT completion fails", async () => {
		const { service, getHandle, getAsset, activate } = setup({ completeFails: true });
		const oldHandle = getHandle().handle;
		await service.inspectRelinkCandidate({ resourceId: "r1", projectId: "p1", intent: "replace-source", original: metadata(), requiredSourceEnd: 9, originalFingerprint: "old-fp", fingerprintVersion: "sha256-v1", candidateHandle: candidate(true), operationId: "op4" });
		expect(await service.commitResourceRelink("op4")).toEqual({ ok: false, reason: "completion-error" });
		expect(getHandle().handle).toBe(oldHandle);
		expect(await getAsset().text()).toBe("old");
		expect(activate).not.toHaveBeenCalled();
	});

	it("prevents stale operations from overwriting a newer inspection", async () => {
		const { service } = setup();
		const input = { resourceId: "r1", projectId: "p1", intent: "replace-source" as const, original: metadata(), requiredSourceEnd: 9, candidateHandle: candidate(true) };
		await service.inspectRelinkCandidate({ ...input, operationId: "old" });
		await service.inspectRelinkCandidate({ ...input, operationId: "new" });
		expect(await service.commitResourceRelink("old")).toEqual({ ok: false, reason: "stale-operation" });
	});
});
