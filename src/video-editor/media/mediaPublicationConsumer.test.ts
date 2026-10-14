import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaPublicationConsumer } from "./mediaPublicationConsumer";
import { createResourceTransferManager } from "./resourceTransferManager";
import { createLocalMediaResolver } from "./localMediaResolver";
import { publicationIdentity, type AcceptedPublication, type PublicationRetirement } from "./mediaPublicationProtocol";

beforeEach(() => { vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:unexpected"), revokeObjectURL: vi.fn() }); });
afterEach(() => { vi.unstubAllGlobals(); });

const accepted = (sequence: number, projectId = "project") => {
	const file = new File(["bytes:" + sequence], "candidate.webm", { type: "video/webm", lastModified: 1 });
	const pointer = { assetStorageKind: "project-copy" as const, assetRef: "asset:" + sequence, sourceKind: "file-handle", sourceRef: "handle:" + sequence, url: "blob:playback:" + sequence, contentFingerprint: "fp:" + sequence, fingerprintVersion: "v1", duration: 4, width: null, height: null, localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted" };
	const candidateFileMetadata = { mime: file.type, size: file.size, lastModified: file.lastModified };
	const receipt: AcceptedPublication = {
		projectId, resourceId: "resource", taskId: "task:" + sequence, operationId: "op:" + sequence, attemptId: "attempt:" + sequence, bootId: "boot", runtimeHandleId: "runtime:" + sequence,
		candidateMetadata: { kind: "video", duration: 4 }, candidateFingerprint: pointer.contentFingerprint, candidateFingerprintVersion: pointer.fingerprintVersion, pointer, candidateFileMetadata, updatedAt: 1,
		kind: "accepted", sequence, previousAcceptedIdentityAndRefs: null,
		acceptedResource: { projectId, resourceId: "resource", name: "kept name", kind: "video", status: "ready", source: { kind: "local" }, data: { status: "ready" }, ...pointer, ...candidateFileMetadata },
	};
	return { receipt, file };
};
const retirement = (receipt: AcceptedPublication): PublicationRetirement => ({ ...receipt, accepted: receipt, pointer: receipt.pointer, assetRef: receipt.pointer.assetRef, handleRef: receipt.pointer.sourceRef, eligible: false, sequence: receipt.sequence, releaseTransferToken: publicationIdentity(receipt, receipt.sequence), releasePlaybackToken: publicationIdentity(receipt, receipt.sequence), disposition: "no-longer-current", reason: "unlinked", excludedAssetRef: null, excludedHandleRef: null });
const fixture = (onTransfer?: (sequence: number) => void, onPlayback?: (sequence: number) => void, onResult?: () => void, onClock?: () => void, onRelease?: () => void) => {
	const revoked: string[] = []; const files = new Map<string, File>(); const installed: number[] = [];
	const results: unknown[] = []; const rejected: unknown[] = []; const released: unknown[] = [];
	const manager = createResourceTransferManager({ getRole: () => "server", getPeerId: () => "owner", chunkSize: 8 });
	const resolver = createLocalMediaResolver({ handleStore: { get: async () => null, put: async () => {}, delete: async () => {}, diagnostics: async () => ({}) } as never, runtime: { createObjectUrl: () => "unused", revokeObjectUrl: (url) => revoked.push(url), setResourceStatus: () => { throw new Error("publication must not emit legacy status"); } } });
	const consumer = createMediaPublicationConsumer({
		installTransfer(record, decision) {
			const url = "blob:transfer:" + decision.sequence; files.set(url, record.file!);
			manager.registerLocalResource(decision.resourceId, record.file!, { objectUrl: url, kind: "video", mime: decision.candidateFileMetadata.mime, duration: 4, size: record.file!.size, chunkSize: 8, ownerPeerId: "owner", sourceKind: "p2p", fallbackUrl: "", name: "kept name", publicationIdentity: publicationIdentity(decision, decision.sequence) });
			installed.push(decision.sequence); onTransfer?.(decision.sequence);
		},
		installPlayback(_record, decision) { resolver.activateObjectUrl(decision.resourceId, decision.pointer.url, "ready-project-copy", publicationIdentity(decision, decision.sequence)); onPlayback?.(decision.sequence); },
		release(_record, event) { released.push(event); onRelease?.(); if (event.sequence !== null) { manager.releaseLocalResource(event.resourceId, event.releaseTransferToken!); resolver.releasePublicationUrl(event.resourceId, event.releasePlaybackToken!); } },
		reject(record) { rejected.push(record); }, result(value) { results.push(value); onResult?.(); }, now: () => { onClock?.(); return 1; },
	});
	const retain = (sequence: number, projectId?: string) => {
		const { receipt, file } = accepted(sequence, projectId);
		const record = consumer.retain(receipt)!; record.file = file; record.proposal = receipt; consumer.settle(record);
		return receipt;
	};
	const send = (receipt: AcceptedPublication) => consumer.consumeDecision({ decision: receipt, bindingEligibility: "current" });
	return { consumer, manager, resolver, retain, send, installed, results, files, revoked, rejected, released };
};

describe("single physical publication consumer", () => {
	it.each([{ order: [1, 2] }, { order: [2, 1] }, { order: [1, 1, 2] }, { order: [2, 2, 1] }])("O1 orders accepted deliveries $order and preserves highest usable bytes", async ({ order }) => {
		const f = fixture(); const receipts = [f.retain(1), f.retain(2)];
		for (const sequence of order) f.send(receipts[sequence - 1]);
		expect(f.installed).toEqual(order[0] === 2 ? [2] : [1, 2]);
		expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:2");
		expect(await f.files.get(f.manager.resolveResourceUrl("resource", ""))?.text()).toBe("bytes:2");
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O2 coalesces nested B/C across projects until A's entire continuation unwinds", () => {
		let f: ReturnType<typeof fixture>; let b: AcceptedPublication; let c: AcceptedPublication;
		const events: string[] = []; let nested = false;
		f = fixture((sequence) => { events.push("transfer:" + sequence); if (sequence === 1) { nested = true; f.send(b); f.send(c); nested = false; } }, (sequence) => events.push("playback:" + sequence), undefined, () => expect(nested).toBe(false));
		const a = f.retain(1); b = f.retain(2, "other-project"); c = f.retain(3, "third-project");
		f.send(a);
		expect(events).toEqual(["transfer:1", "playback:1", "transfer:3", "playback:3"]);
		expect(f.installed).toEqual([1, 3]);
		expect(f.results).toEqual(expect.arrayContaining([expect.objectContaining({ sequence: 2, outcome: "obsolete" }), expect.objectContaining({ sequence: 3, outcome: "installed" })]));
		expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:3");
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O3 a rejected newer request does not fence an older accepted binding", () => {
		const f = fixture(); const a = f.retain(1); const b = f.retain(2);
		f.consumer.consumeDecision({ ...b, kind: "rejected", candidateDisposition: "rollback-unaccepted" });
		f.send(a); expect(f.installed).toEqual([1]); expect(f.rejected).toHaveLength(1);
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O4 a transfer callback throw retains watermark and entered URL ownership", () => {
		const f = fixture((sequence) => { if (sequence === 2) throw new Error("after physical map write"); });
		const a = f.retain(1); const b = f.retain(2); f.send(b); f.send(a); f.send(b);
		expect(f.installed).toEqual([2]); expect(f.manager.resolveResourceUrl("resource", "")).toBe("blob:transfer:2");
		expect(f.results).toEqual(expect.arrayContaining([expect.objectContaining({ sequence: 2, outcome: "indeterminate" })]));
		expect(f.revoked).toEqual([]); expect(f.rejected).toEqual([]); expect(f.released).toEqual([]);
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O4 a preview throw cannot be reported installed or blindly revoke entered playback", () => {
		const f = fixture(undefined, () => { throw new Error("after playback map write"); });
		f.send(f.retain(1)); expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:1");
		expect(f.results).toEqual([expect.objectContaining({ outcome: "indeterminate" })]);
		expect(f.revoked).toEqual([]); expect(f.rejected).toEqual([]); expect(f.released).toEqual([]); f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O5 nested disposal fences preview, results and late delivery", () => {
		let f: ReturnType<typeof fixture>;
		f = fixture(() => { f.consumer.dispose(); });
		const a = f.retain(1); const b = f.retain(2); f.send(a); f.send(b);
		expect(f.installed).toEqual([1]); expect(f.results).toEqual([]);
		expect(f.resolver.resolveResourceUrl("resource", "")).toBe("");
		f.manager.destroy(); f.resolver.destroy();
	});
	it("L3 exact A release leaves installed B bytes and URL intact", async () => {
		const f = fixture(); const a = f.retain(1); const b = f.retain(2); f.send(a); f.send(b);
		f.consumer.consumeRetirement(retirement(a)); f.send(a);
		expect(f.installed).toEqual([1, 2]); expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:2");
		expect(await f.files.get(f.manager.resolveResourceUrl("resource", ""))?.text()).toBe("bytes:2");
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("L1 retirement delivered before acceptance prevents resurrection of the exact token", () => {
		const f = fixture(); const a = f.retain(1); f.consumer.consumeRetirement(retirement(a)); f.send(a);
		expect(f.installed).toEqual([]); expect(f.results).toEqual([expect.objectContaining({ outcome: "obsolete" })]);
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("L2 candidate retirement waits for entered I/O settlement", () => {
		const f = fixture(); const { receipt } = accepted(1); const record = f.consumer.retain(receipt)!;
		f.consumer.consumeRetirement({ ...retirement(receipt), accepted: null, pointer: null, assetRef: null, handleRef: null, sequence: null, releaseTransferToken: null, releasePlaybackToken: null, disposition: "unaccepted" });
		expect(f.released).toEqual([]); record.proposal = receipt; f.consumer.settle(record);
expect(f.released).toEqual([expect.objectContaining({ taskId: receipt.taskId, sequence: null })]);
		expect(record.retired).toBe(true); expect(f.installed).toEqual([]);
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("foreign candidate delivery has no physical capability and does nothing", () => {
		const f = fixture(); f.send(accepted(1).receipt); expect(f.installed).toEqual([]); expect(f.results).toEqual([]);
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
});
describe("publication result delivery uncertainty", () => {
	it("S3 a lost Task result notification replays the receipt without entering host install twice", () => {
		const f = fixture(undefined, undefined, () => { throw new Error("Task result delivery lost"); });
		const receipt = f.retain(1); f.send(receipt); f.send(receipt);
		expect(f.installed).toEqual([1]);
		expect(f.results).toEqual([expect.objectContaining({ outcome: "installed" }), expect.objectContaining({ outcome: "installed" })]);
		expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:1");
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
});
describe("remaining finite R6 boundary rows", () => {
	it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])("O1 rejects malformed accepted sequence %s without poisoning a valid candidate", (sequence) => {
		const f = fixture(); const good = f.retain(1);
		f.send({ ...good, sequence }); f.send(good);
		expect(f.installed).toEqual([1]);
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O2 nested preview delivery cannot enter B before A's preview continuation returns", () => {
		let f: ReturnType<typeof fixture>; let b: AcceptedPublication; const events: string[] = [];
		f = fixture((seq) => events.push("transfer:" + seq), (seq) => { events.push("preview:" + seq); if (seq === 1) { f.send(b); events.push("A-preview-return"); } });
		const a = f.retain(1); b = f.retain(2); f.send(a);
		expect(events).toEqual(["transfer:1", "preview:1", "A-preview-return", "transfer:2", "preview:2"]);
		expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:2");
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
	it("O4 a partial A transfer throw still drains already queued B after A unwinds", () => {
		let f: ReturnType<typeof fixture>; let b: AcceptedPublication;
		f = fixture((seq) => { if (seq === 1) { f.send(b); throw new Error("A entered transfer, then failed"); } });
		const a = f.retain(1); b = f.retain(2); f.send(a); f.send(a);
		expect(f.installed).toEqual([1, 2]);
		expect(f.results).toEqual(expect.arrayContaining([expect.objectContaining({ sequence: 1, outcome: "indeterminate" }), expect.objectContaining({ sequence: 2, outcome: "installed" })]));
		expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:2");
		f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy();
	});
});

// Physical consumer properties complement the real model-captured retirement regression.
describe("canonical prior-host retirement", () => {
	it("keeps B usable across duplicate A retirement and delayed A decisions", async () => {
		const f = fixture(); const a = accepted(1).receipt; const b = f.retain(2); f.send(b);
		try {
			f.consumer.consumeRetirement(retirement(a)); f.consumer.consumeRetirement(retirement(a));
			f.send(a); f.consumer.retain(a); f.send(a);
			expect(f.released).toHaveLength(2);
			expect(f.installed).toEqual([2]);
			expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:2");
			expect(await f.files.get(f.manager.resolveResourceUrl("resource", ""))?.text()).toBe("bytes:2");
		} finally { f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy(); }
	});

	it.each(["tuple", "sequence", "transfer-token", "playback-token", "pointer", "asset-ref", "handle-ref", "disposition", "noncanonical", "unaccepted-unknown"])("rejects %s without releasing B", async (kind) => {
		const f = fixture(); const a = accepted(1).receipt; const event = retirement(a);
		const otherTuple = { ...a, attemptId: "other-attempt" };
		const change: Record<string, unknown> = kind === "tuple" ? { attemptId: otherTuple.attemptId, releaseTransferToken: publicationIdentity(otherTuple, a.sequence), releasePlaybackToken: publicationIdentity(otherTuple, a.sequence) }
			: kind === "sequence" ? { sequence: 2, releaseTransferToken: publicationIdentity(a, 2), releasePlaybackToken: publicationIdentity(a, 2) }
			: kind === "transfer-token" ? { releaseTransferToken: "wrong" }
			: kind === "playback-token" ? { releasePlaybackToken: "wrong" }
			: kind === "pointer" ? { pointer: { ...a.pointer, assetRef: "asset:other" } }
			: kind === "asset-ref" ? { assetRef: "asset:other" }
			: kind === "handle-ref" ? { handleRef: "handle:other" }
			: kind === "disposition" ? { disposition: "unaccepted" }
			: kind === "noncanonical" ? { accepted: { ...a, acceptedResource: null } }
			: { accepted: null, pointer: null, assetRef: null, handleRef: null, sequence: null, releaseTransferToken: null, releasePlaybackToken: null, disposition: "unaccepted" };
		try {
			f.consumer.consumeRetirement({ ...event, ...change });
			f.send(f.retain(2));
			expect(f.released).toEqual([]); expect(f.rejected).toEqual([]);
			expect(f.installed).toEqual([2]);
			expect(f.resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:2");
			expect(await f.files.get(f.manager.resolveResourceUrl("resource", ""))?.text()).toBe("bytes:2");
		} finally { f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy(); }
	});

	it.each([false, true])("serializes nested B behind prior-host release; disposed=%s", async (dispose) => {
		let f: ReturnType<typeof fixture>; let b: AcceptedPublication; const events: string[] = [];
		f = fixture((sequence) => events.push("transfer:" + sequence), (sequence) => events.push("playback:" + sequence), undefined, undefined, () => {
			events.push("release:start"); f.send(b); if (dispose) f.consumer.dispose(); events.push("release:return");
		});
		b = f.retain(2);
		try {
			f.consumer.consumeRetirement(retirement(accepted(1).receipt));
			expect(events).toEqual(dispose ? ["release:start", "release:return"] : ["release:start", "release:return", "transfer:2", "playback:2"]);
			expect(f.installed).toEqual(dispose ? [] : [2]);
			if (!dispose) expect(await f.files.get(f.manager.resolveResourceUrl("resource", ""))?.text()).toBe("bytes:2");
		} finally { f.consumer.dispose(); f.manager.destroy(); f.resolver.destroy(); }
	});
});