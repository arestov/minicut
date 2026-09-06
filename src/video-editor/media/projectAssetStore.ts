export type ProjectAssetMetadata = Record<string, string | number | boolean | null>;
export type ProjectAssetVersionRef = `project/${string}/resource/${string}/asset/${string}`;
export type ProjectAssetManifest = { version: 1 | 2; resourceId: string; fileName: string; dataEntry?: string; assetRef?: ProjectAssetVersionRef; metadata: ProjectAssetMetadata };
export type ProjectAssetPutResult = { ok: true; assetRef: ProjectAssetVersionRef } | { ok: false; reason: "unavailable" | "quota-exceeded" | "aborted" | "storage-error"; error?: unknown };
export type ProjectAssetReconcileResult = { kept: string[]; removed: string[] };
export type ProjectAssetDiagnostics = { available: boolean; committedAssets: number; staleTemporaryEntries: number };

export interface ProjectAssetStore {
	stage(projectId: string, resourceId: string, operationId: string, file: File, metadata: ProjectAssetMetadata, options?: { signal?: AbortSignal }): Promise<ProjectAssetPutResult>;
	validate(assetRef: string): Promise<boolean>;
	publishOutcome(assetRef: string): Promise<boolean>;
	rollback(assetRef: string): Promise<void>;
	cleanup(projectId: string, resourceId: string, publishedAssetRef: string): Promise<number>;
	reconcile(projectId: string, resourceId: string, publishedAssetRef: string | null): Promise<ProjectAssetReconcileResult>;
	getFileByRef(assetRef: string): Promise<File | null>;
	migrateLegacy(projectId: string, resourceId: string, operationId: string): Promise<ProjectAssetPutResult | null>;
	putFromFile(projectId: string, resourceId: string, file: File, metadata: ProjectAssetMetadata, options?: { signal?: AbortSignal; operationId?: string }): Promise<ProjectAssetPutResult>;
	getFile(projectId: string, resourceId: string): Promise<File | null>;
	has(projectId: string, resourceId: string): Promise<boolean>;
	deleteResource(projectId: string, resourceId: string): Promise<void>;
	deleteProject(projectId: string): Promise<void>;
	cleanupStaleTemporaryEntries(projectId: string): Promise<number>;
	diagnostics(): Promise<ProjectAssetDiagnostics>;
}

export type ProjectAssetRootProvider = () => Promise<FileSystemDirectoryHandle | null>;
type IterableDirectoryHandle = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
const entriesOf = (handle: FileSystemDirectoryHandle) => (handle as IterableDirectoryHandle).entries();
const safeSegment = (value: string): string => { if (!value || value === "." || value === ".." || /[\\/]/.test(value)) throw new Error("Invalid project asset key"); return value; };
const directory = (parent: FileSystemDirectoryHandle, name: string, create = false) => parent.getDirectoryHandle(safeSegment(name), { create });
const writeFile = async (handle: FileSystemFileHandle, value: Blob | string) => { const writable = await handle.createWritable(); try { await writable.write(value); await writable.close(); } catch (error) { await writable.abort?.().catch(() => undefined); throw error; } };
const readJson = async <T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> => { try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()) as T; } catch { return null; } };
const classifyWriteError = (error: unknown): ProjectAssetPutResult => { const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : ""; if (name === "QuotaExceededError") return { ok: false, reason: "quota-exceeded", error }; if (name === "AbortError") return { ok: false, reason: "aborted", error }; return { ok: false, reason: "storage-error", error }; };
const makeAssetRef = (projectId: string, resourceId: string, operationId: string): ProjectAssetVersionRef => `project/${safeSegment(projectId)}/resource/${safeSegment(resourceId)}/asset/${safeSegment(operationId)}`;
const parseAssetRef = (value: string) => { const p = value.split("/"); return p.length === 6 && p[0] === "project" && p[2] === "resource" && p[4] === "asset" ? { projectId: safeSegment(p[1]), resourceId: safeSegment(p[3]), operationId: safeSegment(p[5]) } : null; };

export const createProjectAssetStore = (getRoot: ProjectAssetRootProvider): ProjectAssetStore => {
	const rootOrNull = async () => { try { return await getRoot(); } catch { return null; } };
	const projectDir = async (root: FileSystemDirectoryHandle, projectId: string, create = false) => directory(await directory(root, "projects", create), projectId, create);
	const resourceDir = async (root: FileSystemDirectoryHandle, projectId: string, resourceId: string, create = false) => directory(await directory(await projectDir(root, projectId, create), "assets", create), resourceId, create);
	const versionsDir = async (root: FileSystemDirectoryHandle, projectId: string, resourceId: string, create = false) => directory(await resourceDir(root, projectId, resourceId, create), "versions", create);
	const versionDir = async (root: FileSystemDirectoryHandle, projectId: string, resourceId: string, operationId: string, create = false) => directory(await versionsDir(root, projectId, resourceId, create), operationId, create);
	const api: ProjectAssetStore = {
		async stage(projectId, resourceId, operationId, file, metadata, options = {}) {
			const root = await rootOrNull(); if (!root) return { ok: false, reason: "unavailable" };
			const ref = makeAssetRef(projectId, resourceId, operationId);
			try {
				if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
				const staging = await directory(await projectDir(root, projectId, true), "staging", true);
				const tempName = `${safeSegment(resourceId)}-${safeSegment(operationId)}`;
				await writeFile(await staging.getFileHandle(tempName, { create: true }), file);
				if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
				const version = await versionDir(root, projectId, resourceId, operationId, true);
				await writeFile(await version.getFileHandle("original", { create: true }), file);
				await writeFile(await version.getFileHandle("metadata.json", { create: true }), JSON.stringify({ version: 2, resourceId, operationId, fileName: file.name, metadata }));
				await staging.removeEntry(tempName).catch(() => undefined);
				return { ok: true, assetRef: ref };
			} catch (error) { return classifyWriteError(error); }
		},
		async validate(ref) { return (await api.getFileByRef(ref)) !== null; },
		async publishOutcome(ref) {
			const parsed = parseAssetRef(ref); const root = await rootOrNull(); if (!parsed || !root || !await api.validate(ref)) return false;
			const meta = await readJson<{ fileName: string; metadata: ProjectAssetMetadata }>(await versionDir(root, parsed.projectId, parsed.resourceId, parsed.operationId), "metadata.json"); if (!meta) return false;
			const manifest: ProjectAssetManifest = { version: 2, resourceId: parsed.resourceId, fileName: meta.fileName, assetRef: ref as ProjectAssetVersionRef, metadata: meta.metadata };
			await writeFile(await (await resourceDir(root, parsed.projectId, parsed.resourceId, true)).getFileHandle("manifest.json", { create: true }), JSON.stringify(manifest)); return true;
		},
		async rollback(ref) { const parsed = parseAssetRef(ref); const root = await rootOrNull(); if (!parsed || !root) return; try { await (await versionsDir(root, parsed.projectId, parsed.resourceId)).removeEntry(parsed.operationId, { recursive: true }); } catch { /* idempotent */ } },
		async cleanup(projectId, resourceId, publishedRef) { return (await api.reconcile(projectId, resourceId, publishedRef)).removed.length; },
		async reconcile(projectId, resourceId, publishedRef) {
			const root = await rootOrNull(); const result: ProjectAssetReconcileResult = { kept: [], removed: [] }; if (!root) return result;
			try { const versions = await versionsDir(root, projectId, resourceId); for await (const [operationId, entry] of entriesOf(versions)) { if (entry.kind !== "directory") continue; const ref = makeAssetRef(projectId, resourceId, operationId); if (ref === publishedRef && await api.validate(ref)) result.kept.push(ref); else { await versions.removeEntry(operationId, { recursive: true }); result.removed.push(ref); } } } catch { /* none */ }
			await api.cleanupStaleTemporaryEntries(projectId); return result;
		},
		async getFileByRef(ref) { const parsed = parseAssetRef(ref); const root = await rootOrNull(); if (!parsed || !root) return null; try { return await (await (await versionDir(root, parsed.projectId, parsed.resourceId, parsed.operationId)).getFileHandle("original")).getFile(); } catch { return null; } },
		async migrateLegacy(projectId, resourceId, operationId) {
			const root = await rootOrNull(); if (!root) return { ok: false, reason: "unavailable" };
			try { const resource = await resourceDir(root, projectId, resourceId); const legacy = await readJson<ProjectAssetManifest>(resource, "manifest.json"); if (!legacy || legacy.version !== 1 || !legacy.dataEntry) return null; const file = await (await resource.getFileHandle(legacy.dataEntry)).getFile(); return api.stage(projectId, resourceId, operationId, new File([file], legacy.fileName, { type: file.type }), legacy.metadata); } catch (error) { return classifyWriteError(error); }
		},
		async putFromFile(projectId, resourceId, file, metadata, options = {}) { const staged = await api.stage(projectId, resourceId, options.operationId ?? crypto.randomUUID(), file, metadata, options); if (!staged.ok) return staged; try { if (!await api.validate(staged.assetRef) || !await api.publishOutcome(staged.assetRef)) { await api.rollback(staged.assetRef); return { ok: false, reason: "storage-error" }; } return staged; } catch (error) { await api.rollback(staged.assetRef); return classifyWriteError(error); } },
		async getFile(projectId, resourceId) { const root = await rootOrNull(); if (!root) return null; try { const resource = await resourceDir(root, projectId, resourceId); const manifest = await readJson<ProjectAssetManifest>(resource, "manifest.json"); if (!manifest || manifest.resourceId !== resourceId) return null; if (manifest.version === 2 && manifest.assetRef) return api.getFileByRef(manifest.assetRef); return manifest.dataEntry ? (await resource.getFileHandle(manifest.dataEntry)).getFile() : null; } catch { return null; } },
		async has(projectId, resourceId) { return (await api.getFile(projectId, resourceId)) !== null; },
		async deleteResource(projectId, resourceId) { const root = await rootOrNull(); if (!root) return; try { await (await directory(await projectDir(root, projectId), "assets")).removeEntry(safeSegment(resourceId), { recursive: true }); } catch { /* absent */ } },
		async deleteProject(projectId) { const root = await rootOrNull(); if (!root) return; try { await (await directory(root, "projects")).removeEntry(safeSegment(projectId), { recursive: true }); } catch { /* absent */ } },
		async cleanupStaleTemporaryEntries(projectId) { const root = await rootOrNull(); if (!root) return 0; let removed = 0; for (const name of ["tmp", "staging"]) try { const dir = await directory(await projectDir(root, projectId), name); for await (const [entry] of entriesOf(dir)) { await dir.removeEntry(entry, { recursive: true }); removed += 1; } } catch { /* absent */ } return removed; },
		async diagnostics() { const root = await rootOrNull(); if (!root) return { available: false, committedAssets: 0, staleTemporaryEntries: 0 }; let committedAssets = 0; let staleTemporaryEntries = 0; try { for await (const [, project] of entriesOf(await directory(root, "projects"))) { if (project.kind !== "directory") continue; for (const name of ["tmp", "staging"]) try { for await (const _ of entriesOf(await directory(project as FileSystemDirectoryHandle, name))) staleTemporaryEntries += 1; } catch { /* absent */ } try { for await (const [, resource] of entriesOf(await directory(project as FileSystemDirectoryHandle, "assets"))) if (resource.kind === "directory" && await readJson(resource as FileSystemDirectoryHandle, "manifest.json")) committedAssets += 1; } catch { /* absent */ } } } catch { /* empty */ } return { available: true, committedAssets, staleTemporaryEntries }; },
	}; return api;
};

export const browserProjectAssetRoot: ProjectAssetRootProvider = async () => { const storage = globalThis.navigator?.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> }; return typeof storage?.getDirectory === "function" ? storage.getDirectory() : null; };
