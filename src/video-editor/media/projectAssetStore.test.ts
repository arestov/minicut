import { publicationRetirements, type AcceptedPublication, type PublicationOwnership } from "./mediaPublicationProtocol";
import { indexedDB } from "fake-indexeddb";
import { createLocalMediaHandleStore } from "./localMediaHandleStore";
import { commitRecoveryStorage } from "./mediaRecoveryStorageCommit";
import { describe, expect, it } from "vitest";
import { createProjectAssetStore } from "./projectAssetStore";

class MemoryWritable {
	private value: Blob = new Blob();
	constructor(private readonly commit: (value: Blob) => void, private readonly failure?: Error) {}
	async write(value: Blob | string) { if (this.failure) throw this.failure; this.value = value instanceof Blob ? value : new Blob([value]); }
	async close() { if (this.failure) throw this.failure; this.commit(this.value); }
	async abort() {}
}

class MemoryFileHandle {
	kind = "file" as const;
	value: Blob = new Blob();
	failure?: Error;
	constructor(public readonly name: string) {}
	async createWritable() { return new MemoryWritable((value) => { this.value = value; }, this.failure); }
	async getFile() { return new File([this.value], this.name, { type: this.value.type }); }
}

class MemoryDirectoryHandle {
	kind = "directory" as const;
	entriesMap = new Map<string, MemoryDirectoryHandle | MemoryFileHandle>();
onRemove?: () => void;
	constructor(public readonly name: string) {}
	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		const found = this.entriesMap.get(name);
		if (found instanceof MemoryDirectoryHandle) return found;
		if (!options?.create) throw new DOMException("Missing", "NotFoundError");
		const value = new MemoryDirectoryHandle(name); this.entriesMap.set(name, value); return value;
	}
	async getFileHandle(name: string, options?: { create?: boolean }) {
		const found = this.entriesMap.get(name);
		if (found instanceof MemoryFileHandle) return found;
		if (!options?.create) throw new DOMException("Missing", "NotFoundError");
		const value = new MemoryFileHandle(name); this.entriesMap.set(name, value); return value;
	}
	async removeEntry(name: string) { if (!this.entriesMap.delete(name)) throw new DOMException("Missing", "NotFoundError"); this.onRemove?.(); }
	async *entries() { yield* this.entriesMap.entries(); }
}

const rootAndStore = () => {
	const root = new MemoryDirectoryHandle("root");
	return { root, store: createProjectAssetStore(async () => root as unknown as FileSystemDirectoryHandle) };
};

describe("projectAssetStore", () => {
	it("puts, detects, and reads a committed asset", async () => {
		const { store } = rootAndStore();
		const result = await store.putFromFile("p1", "r1", new File(["media"], "clip.mp4"), { mime: "video/mp4" }, { operationId: "op1" });
		expect(result).toEqual({ ok: true, assetRef: "project/p1/resource/r1/asset/op1" });
		expect(await store.has("p1", "r1")).toBe(true);
		expect(await (await store.getFile("p1", "r1"))?.text()).toBe("media");
	});

	it("does not expose an interrupted temporary write", async () => {
		const { root, store } = rootAndStore();
		const projects = await root.getDirectoryHandle("projects", { create: true });
		const project = await projects.getDirectoryHandle("p1", { create: true });
		const tmp = await project.getDirectoryHandle("tmp", { create: true });
		(await tmp.getFileHandle("r1-stale", { create: true })).value = new Blob(["partial"]);
		expect(await store.has("p1", "r1")).toBe(false);
		expect(await store.cleanupStaleTemporaryEntries("p1")).toBe(1);
	});

	it("keeps the previous manifest readable when a new write fails", async () => {
		const { root, store } = rootAndStore();
		await store.putFromFile("p1", "r1", new File(["old"], "old.mp4"), {}, { operationId: "old" });
		const projects = await root.getDirectoryHandle("projects");
		const resource = await (await (await projects.getDirectoryHandle("p1")).getDirectoryHandle("assets")).getDirectoryHandle("r1");
		const versions = await resource.getDirectoryHandle("versions", { create: true });
		const next = await versions.getDirectoryHandle("new", { create: true });
		const failing = await next.getFileHandle("original", { create: true });
		failing.failure = new Error("write failed");
		const result = await store.putFromFile("p1", "r1", new File(["new"], "new.mp4"), {}, { operationId: "new" });
		expect(result).toMatchObject({ ok: false, reason: "storage-error" });
		expect(await (await store.getFile("p1", "r1"))?.text()).toBe("old");
	});

	it("returns a typed quota result", async () => {
		const { root, store } = rootAndStore();
		const projects = await root.getDirectoryHandle("projects", { create: true });
		const project = await projects.getDirectoryHandle("p1", { create: true });
		const tmp = await project.getDirectoryHandle("staging", { create: true });
		const file = await tmp.getFileHandle("r1-quota", { create: true });
		file.failure = new DOMException("quota", "QuotaExceededError");
		expect(await store.putFromFile("p1", "r1", new File(["x"], "x"), {}, { operationId: "quota" })).toMatchObject({ ok: false, reason: "quota-exceeded" });
	});

	it("deletes only the selected resource or project", async () => {
		const { store } = rootAndStore();
		for (const [project, resource] of [["p1", "r1"], ["p1", "r2"], ["p2", "r1"]]) await store.putFromFile(project, resource, new File([resource], resource), {}, { operationId: `${project}-${resource}` });
		await store.deleteResource("p1", "r1");
		expect(await store.has("p1", "r1")).toBe(false);
		expect(await store.has("p1", "r2")).toBe(true);
		expect(await store.has("p2", "r1")).toBe(true);
		await store.deleteProject("p1");
		expect(await store.has("p1", "r2")).toBe(false);
		expect(await store.has("p2", "r1")).toBe(true);
	});

	it("reports counts without reading media files", async () => {
		const { root, store } = rootAndStore();
		await store.putFromFile("p1", "r1", new File(["bytes"], "x"), {}, { operationId: "op" });
		const projects = await root.getDirectoryHandle("projects");
		const resource = await (await (await projects.getDirectoryHandle("p1")).getDirectoryHandle("assets")).getDirectoryHandle("r1");
		const data = await (await (await resource.getDirectoryHandle("versions")).getDirectoryHandle("op")).getFileHandle("original");
		data.getFile = async () => { throw new Error("bytes must not be read"); };
		expect(await store.diagnostics()).toEqual({ available: true, committedAssets: 1, staleTemporaryEntries: 0 });
	});

	it("stages immutable versions and reconciles only against the published DKT pointer", async () => {
		const { store } = rootAndStore();
		const old = await store.stage("p1", "r1", "old", new File(["old"], "old.mp4"), {});
		const next = await store.stage("p1", "r1", "next", new File(["next"], "next.mp4"), {});
		expect(old.ok && await store.validate(old.assetRef)).toBe(true);
		expect(next.ok && await store.validate(next.assetRef)).toBe(true);
		const outcome = await store.reconcile("p1", "r1", old.ok ? old.assetRef : null);
		expect(outcome.kept).toEqual(["project/p1/resource/r1/asset/old"]);
		expect(outcome.removed).toEqual(["project/p1/resource/r1/asset/next"]);
		expect(next.ok && await store.getFileByRef(next.assetRef)).toBeNull();
	});

	it("rolls back an unpublished version without changing the published version", async () => {
		const { store } = rootAndStore();
		const published = await store.putFromFile("p1", "r1", new File(["old"], "old.mp4"), {}, { operationId: "old" });
		const staged = await store.stage("p1", "r1", "failed", new File(["new"], "new.mp4"), {});
		if (staged.ok) await store.rollback(staged.assetRef);
		expect(await (await store.getFile("p1", "r1"))?.text()).toBe("old");
		expect(published.ok && await store.validate(published.assetRef)).toBe(true);
	});
});

describe("owned publication storage bytes", () => {
	it("S1 keeps actual candidate bytes and exact handle after a lost dispatch receipt", async () => {
		const { store, root } = rootAndStore(); const handles = createLocalMediaHandleStore(indexedDB);
		const result = await commitRecoveryStorage({
			projectId: "uncertain-project", resourceId: "uncertain-resource", operationId: "uncertain-op",
			file: new File(["candidate-bytes"], "candidate.webm", { type: "video/webm" }), assetMetadata: {},
			handleRecord: { resourceId: "uncertain-resource", handle: { kind: "file", name: "candidate.webm" } as FileSystemFileHandle, name: "candidate.webm", size: 15, mime: "video/webm", lastModified: 1, createdAt: 1, updatedAt: 1 },
			assets: store, handles, publish: async () => { throw new Error("dispatch may already have committed"); },
		});
		expect(result).toMatchObject({ ok: true, publication: { kind: "indeterminate" } });
		expect(await (await store.getFileByRef(result.assetRef!))?.text()).toBe("candidate-bytes");
		expect((await handles.getByRef(result.handleRef!))?.name).toBe("candidate.webm");
const reopened = createProjectAssetStore(async () => root as unknown as FileSystemDirectoryHandle);
expect(await (await reopened.getFileByRef(result.assetRef!))?.text()).toBe("candidate-bytes");
	});
	it("S4 cancels a stale resource reconciliation before deleting protected new bytes", async () => {
		const { store } = rootAndStore();
		const old = await store.stage("p-protect", "r-protect", "old", new File(["old"], "old"), {});
		const fresh = await store.stage("p-protect", "r-protect", "new", new File(["new"], "new"), {});
		expect(old.ok && fresh.ok).toBe(true);
		store.protectPublicationResource("p-protect", "r-protect");
		await store.reconcile("p-protect", "r-protect", old.ok ? old.assetRef : null);
		expect(await (await store.getFileByRef(fresh.ok ? fresh.assetRef : ""))?.text()).toBe("new");
	});
	it("S4 excludes protected project temporary entries from stale enumeration", async () => {
		const { root, store } = rootAndStore();
		const project = await (await root.getDirectoryHandle("projects", { create: true })).getDirectoryHandle("p-temp", { create: true });
		const staging = await project.getDirectoryHandle("staging", { create: true });
		(await staging.getFileHandle("r-active-operation", { create: true })).value = new Blob(["entered-stage"]);
		store.protectPublicationResource("p-temp", "r-active");
		expect(await store.cleanupStaleTemporaryEntries("p-temp")).toBe(0);
		expect(await (await staging.getFileHandle("r-active-operation")).getFile().then((f) => f.text())).toBe("entered-stage");
	});
});
describe("owned OPFS deletion boundaries (internal callback injection)", () => {
	it("S4 stops a stale version pass when ownership arrives after its first delete", async () => {
		const { store, root } = rootAndStore();
		await store.stage("p-delete", "r-delete", "old", new File(["old"], "old"), {});
		const fresh = await store.stage("p-delete", "r-delete", "new", new File(["new-current-bytes"], "new"), {});
		const project = await (await root.getDirectoryHandle("projects")).getDirectoryHandle("p-delete");
		const versions = await (await (await project.getDirectoryHandle("assets")).getDirectoryHandle("r-delete")).getDirectoryHandle("versions");
		versions.onRemove = () => store.protectPublicationResource("p-delete", "r-delete");
		expect((await store.reconcile("p-delete", "r-delete", null)).removed).toHaveLength(1);
		expect(await (await store.getFileByRef(fresh.ok ? fresh.assetRef : ""))?.text()).toBe("new-current-bytes");
	});
	it("S4 rechecks protected temporary ownership before every remaining deletion", async () => {
		const { store, root } = rootAndStore();
		const project = await (await root.getDirectoryHandle("projects", { create: true })).getDirectoryHandle("p-temp-boundary", { create: true });
		const temporary = await project.getDirectoryHandle("tmp", { create: true });
		(await temporary.getFileHandle("old", { create: true })).value = new Blob(["old"]);
		(await temporary.getFileHandle("entered-new", { create: true })).value = new Blob(["entered-new-bytes"]);
		temporary.onRemove = () => store.protectPublicationResource("p-temp-boundary", "r-new");
		expect(await store.cleanupStaleTemporaryEntries("p-temp-boundary")).toBe(1);
		expect(await (await temporary.getFileHandle("entered-new")).getFile().then((f) => f.text())).toBe("entered-new-bytes");
	});
});

describe("current backing retirement bytes (internal serial manifest control)", () => {
	it.each(["both-current", "reused-asset", "explicit-null"] as const)("retains only pointed refs for %s despite ineligible accepted ownership", async (mode) => {
		const { store } = rootAndStore(); const handles = createLocalMediaHandleStore(indexedDB);
		const projectId = "backing-" + mode; const resourceId = "resource-" + mode;
		const file = new File(["pointed-publication-bytes"], "current.webm", { type: "video/webm", lastModified: 1 });
		const asset = await store.stage(projectId, resourceId, "A", file, {});
		expect(asset.ok).toBe(true); if (!asset.ok) throw new Error("Expected staged File");
		const handleRef = await handles.stage(projectId, resourceId, "A", {
			resourceId, handle: { kind: "file", name: "current.webm" } as FileSystemFileHandle,
			name: "current.webm", size: file.size, mime: file.type, lastModified: 1, createdAt: 1, updatedAt: 1,
		});
		const pointer = {
			assetStorageKind: "project-copy" as const, assetRef: asset.assetRef, sourceKind: "file-handle", sourceRef: handleRef,
			url: "blob:current", contentFingerprint: "fp:A", fingerprintVersion: "v1", duration: 4, width: null, height: null,
			localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted",
		};
		const candidateFileMetadata = { mime: file.type, size: file.size, lastModified: file.lastModified };
		const accepted: AcceptedPublication = {
			projectId, resourceId, taskId: "task:A", operationId: "A", attemptId: "attempt:A", bootId: "boot:A", runtimeHandleId: "runtime:A",
			kind: "accepted", sequence: 1, candidateMetadata: { kind: "video", duration: 4 }, candidateFingerprint: "fp:A", candidateFingerprintVersion: "v1",
			pointer, candidateFileMetadata, updatedAt: 1, previousAcceptedIdentityAndRefs: null,
			acceptedResource: { projectId, resourceId, name: file.name, kind: "video", status: "ready", source: { kind: "local" }, data: { status: "ready" }, ...pointer, ...candidateFileMetadata },
		};
		const original: PublicationOwnership = { ...accepted, accepted, pointer, assetRef: asset.assetRef, handleRef, eligible: true };
		const newerHandle = mode === "reused-asset" ? await handles.stage(projectId, resourceId, "C", {
			resourceId, handle: { kind: "file", name: "new-current.webm" } as FileSystemFileHandle,
			name: "new-current.webm", size: file.size, mime: file.type, lastModified: 1, createdAt: 1, updatedAt: 1,
		}) : handleRef;
		const current = { ...original, eligible: false, currentBacking: mode === "explicit-null" ? null : { projectId, assetRef: asset.assetRef, handleRef: newerHandle } };
		const events = publicationRetirements({ accepted: [original], candidates: [] }, { accepted: [current], candidates: [] });
		expect(events).toHaveLength(1);
		// Existing exact rollback APIs consume the captured exclusions; no filesystem mirror or spy-only oracle.
		for (const event of events) {
			if (event.assetRef && event.assetRef !== event.excludedAssetRef) await store.rollback(event.assetRef);
			if (event.handleRef && event.handleRef !== event.excludedHandleRef) await handles.rollback(event.handleRef);
		}
		if (mode === "explicit-null") {
			expect(await store.getFileByRef(asset.assetRef)).toBeNull();
			expect(await handles.getByRef(handleRef)).toBeNull();
		} else {
			expect(await (await store.getFileByRef(asset.assetRef))?.text()).toBe("pointed-publication-bytes");
			expect((await handles.getByRef(newerHandle))?.name).toBe(mode === "reused-asset" ? "new-current.webm" : "current.webm");
			if (mode === "reused-asset") expect(await handles.getByRef(handleRef)).toBeNull();
		}
		expect(events[0]).toMatchObject({ excludedAssetRef: mode === "explicit-null" ? null : asset.assetRef, excludedHandleRef: mode === "explicit-null" ? null : newerHandle });
	});
});
