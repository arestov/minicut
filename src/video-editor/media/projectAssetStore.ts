export type ProjectAssetMetadata = Record<string, string | number | boolean | null>;

export type ProjectAssetManifest = {
	version: 1;
	resourceId: string;
	fileName: string;
	dataEntry: string;
	metadata: ProjectAssetMetadata;
};

export type ProjectAssetPutResult =
	| { ok: true; assetRef: string }
	| { ok: false; reason: "unavailable" | "quota-exceeded" | "aborted" | "storage-error"; error?: unknown };

export type ProjectAssetDiagnostics = {
	available: boolean;
	committedAssets: number;
	staleTemporaryEntries: number;
};

export interface ProjectAssetStore {
	putFromFile(projectId: string, resourceId: string, file: File, metadata: ProjectAssetMetadata, options?: { signal?: AbortSignal; operationId?: string }): Promise<ProjectAssetPutResult>;
	getFile(projectId: string, resourceId: string): Promise<File | null>;
	has(projectId: string, resourceId: string): Promise<boolean>;
	deleteResource(projectId: string, resourceId: string): Promise<void>;
	deleteProject(projectId: string): Promise<void>;
	cleanupStaleTemporaryEntries(projectId: string): Promise<number>;
	diagnostics(): Promise<ProjectAssetDiagnostics>;
}

export type ProjectAssetRootProvider = () => Promise<FileSystemDirectoryHandle | null>;

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

const entriesOf = (handle: FileSystemDirectoryHandle) =>
	(handle as IterableDirectoryHandle).entries();

const safeSegment = (value: string): string => {
	if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
		throw new Error("Invalid project asset key");
	}
	return value;
};

const directory = (parent: FileSystemDirectoryHandle, name: string, create = false) =>
	parent.getDirectoryHandle(safeSegment(name), { create });

const readManifest = async (resourceDir: FileSystemDirectoryHandle): Promise<ProjectAssetManifest | null> => {
	try {
		const file = await (await resourceDir.getFileHandle("manifest.json")).getFile();
		const parsed = JSON.parse(await file.text()) as Partial<ProjectAssetManifest>;
		return parsed.version === 1 && typeof parsed.dataEntry === "string" && typeof parsed.resourceId === "string"
			? parsed as ProjectAssetManifest
			: null;
	} catch {
		return null;
	}
};

const writeFile = async (handle: FileSystemFileHandle, value: Blob | string) => {
	const writable = await handle.createWritable();
	try {
		await writable.write(value);
		await writable.close();
	} catch (error) {
		await writable.abort?.().catch(() => undefined);
		throw error;
	}
};

const classifyWriteError = (error: unknown): ProjectAssetPutResult => {
	const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
	if (name === "QuotaExceededError") return { ok: false, reason: "quota-exceeded", error };
	if (name === "AbortError") return { ok: false, reason: "aborted", error };
	return { ok: false, reason: "storage-error", error };
};

const getProjects = async (root: FileSystemDirectoryHandle, create = false) => directory(root, "projects", create);

export const createProjectAssetStore = (getRoot: ProjectAssetRootProvider): ProjectAssetStore => {
	const rootOrNull = async () => {
		try { return await getRoot(); } catch { return null; }
	};

	const resourceDirectory = async (root: FileSystemDirectoryHandle, projectId: string, resourceId: string, create = false) => {
		const projects = await getProjects(root, create);
		const project = await directory(projects, projectId, create);
		const assets = await directory(project, "assets", create);
		return directory(assets, resourceId, create);
	};

	return {
		async putFromFile(projectId, resourceId, file, metadata, options = {}) {
			const root = await rootOrNull();
			if (!root) return { ok: false, reason: "unavailable" };
			const operationId = safeSegment(options.operationId ?? crypto.randomUUID());
			try {
				if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
				const projects = await getProjects(root, true);
				const project = await directory(projects, projectId, true);
				const tmp = await directory(project, "tmp", true);
				const tempName = `${safeSegment(resourceId)}-${operationId}`;
				await writeFile(await tmp.getFileHandle(tempName, { create: true }), file);
				if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

				const resourceDir = await resourceDirectory(root, projectId, resourceId, true);
				const dataEntry = `original-${operationId}`;
				await writeFile(await resourceDir.getFileHandle(dataEntry, { create: true }), file);
				const manifest: ProjectAssetManifest = { version: 1, resourceId, fileName: file.name, dataEntry, metadata };
				await writeFile(await resourceDir.getFileHandle("manifest.json", { create: true }), JSON.stringify(manifest));
				await tmp.removeEntry(tempName).catch(() => undefined);
				return { ok: true, assetRef: `${projectId}/${resourceId}` };
			} catch (error) {
				return classifyWriteError(error);
			}
		},

		async getFile(projectId, resourceId) {
			const root = await rootOrNull();
			if (!root) return null;
			try {
				const resourceDir = await resourceDirectory(root, projectId, resourceId);
				const manifest = await readManifest(resourceDir);
				if (!manifest || manifest.resourceId !== resourceId) return null;
				return await (await resourceDir.getFileHandle(manifest.dataEntry)).getFile();
			} catch { return null; }
		},

		async has(projectId, resourceId) { return (await this.getFile(projectId, resourceId)) !== null; },

		async deleteResource(projectId, resourceId) {
			const root = await rootOrNull(); if (!root) return;
			try {
				const projects = await getProjects(root);
				const project = await directory(projects, projectId);
				const assets = await directory(project, "assets");
				await assets.removeEntry(safeSegment(resourceId), { recursive: true });
			} catch { /* already absent */ }
		},

		async deleteProject(projectId) {
			const root = await rootOrNull(); if (!root) return;
			try { await (await getProjects(root)).removeEntry(safeSegment(projectId), { recursive: true }); } catch { /* already absent */ }
		},

		async cleanupStaleTemporaryEntries(projectId) {
			const root = await rootOrNull(); if (!root) return 0;
			let removed = 0;
			try {
				const tmp = await directory(await directory(await getProjects(root), projectId), "tmp");
				for await (const [name] of entriesOf(tmp)) { await tmp.removeEntry(name, { recursive: true }); removed += 1; }
			} catch { /* no temp directory */ }
			return removed;
		},

		async diagnostics() {
			const root = await rootOrNull();
			if (!root) return { available: false, committedAssets: 0, staleTemporaryEntries: 0 };
			let committedAssets = 0; let staleTemporaryEntries = 0;
			try {
				for await (const [, projectEntry] of entriesOf(await getProjects(root))) {
					if (projectEntry.kind !== "directory") continue;
					try { for await (const _ of entriesOf(await directory(projectEntry as FileSystemDirectoryHandle, "tmp"))) staleTemporaryEntries += 1; } catch { /* none */ }
					try {
						for await (const [, asset] of entriesOf(await directory(projectEntry as FileSystemDirectoryHandle, "assets"))) {
							if (asset.kind === "directory" && await readManifest(asset as FileSystemDirectoryHandle)) committedAssets += 1;
						}
					} catch { /* none */ }
				}
			} catch { /* empty */ }
			return { available: true, committedAssets, staleTemporaryEntries };
		},
	};
};

export const browserProjectAssetRoot: ProjectAssetRootProvider = async () => {
	const storage = globalThis.navigator?.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
	return typeof storage?.getDirectory === "function" ? storage.getDirectory() : null;
};
