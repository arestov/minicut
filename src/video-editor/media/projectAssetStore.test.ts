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
	async removeEntry(name: string) { if (!this.entriesMap.delete(name)) throw new DOMException("Missing", "NotFoundError"); }
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
		expect(result).toEqual({ ok: true, assetRef: "p1/r1" });
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
		const failing = await resource.getFileHandle("original-new", { create: true });
		failing.failure = new Error("write failed");
		const result = await store.putFromFile("p1", "r1", new File(["new"], "new.mp4"), {}, { operationId: "new" });
		expect(result).toMatchObject({ ok: false, reason: "storage-error" });
		expect(await (await store.getFile("p1", "r1"))?.text()).toBe("old");
	});

	it("returns a typed quota result", async () => {
		const { root, store } = rootAndStore();
		const projects = await root.getDirectoryHandle("projects", { create: true });
		const project = await projects.getDirectoryHandle("p1", { create: true });
		const tmp = await project.getDirectoryHandle("tmp", { create: true });
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
		const data = await resource.getFileHandle("original-op");
		data.getFile = async () => { throw new Error("bytes must not be read"); };
		expect(await store.diagnostics()).toEqual({ available: true, committedAssets: 1, staleTemporaryEntries: 0 });
	});
});
