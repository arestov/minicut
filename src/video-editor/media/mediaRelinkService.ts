import { evaluateRelinkCandidate, type MediaTechnicalMetadata, type RelinkPolicyResult } from "./mediaRelinkPolicy";
import type { ProjectAssetStore } from "./projectAssetStore";
import type { PermissionFileHandle } from "./localMediaResolver";

export type RelinkIntent = "locate-original" | "replace-source";
export type RelinkInspection = {
	operationId: string;
	intent: RelinkIntent;
	policy: RelinkPolicyResult;
	candidate: MediaTechnicalMetadata;
	confirmationToken: string | null;
};
export type RelinkCommitResult =
	| { ok: true }
	| { ok: false; reason: "stale-operation" | "confirmation-required" | "incompatible" | "storage-error" | "completion-error" };

type HandleRecord = { resourceId: string; handle: FileSystemFileHandle; name: string; size: number; lastModified: number; mime: string; createdAt: number; updatedAt: number };
type RelinkCandidate = { handle: PermissionFileHandle; file: File };
type Pending = RelinkInspection & { resourceId: string; projectId: string; candidateValue: RelinkCandidate; fingerprint: string | null; fingerprintVersion: string | null };

export const createMediaRelinkService = (deps: {
	handles: { get(id: string): Promise<HandleRecord | null>; put(record: HandleRecord): Promise<void>; delete(id: string): Promise<void> };
	assets: ProjectAssetStore;
	probe(file: File): Promise<MediaTechnicalMetadata>;
	fingerprint(file: File): Promise<{ fingerprint: string; version: string }>;
	createObjectUrl(file: File): string | null;
	revokeObjectUrl(url: string): void;
	complete(payload: Record<string, unknown>): Promise<void> | void;
	activate(resourceId: string, url: string): void;
	now(): number;
}) => {
	const pending = new Map<string, Pending>();
	const latest = new Map<string, string>();

	const inspectRelinkCandidate = async (input: {
		resourceId: string; projectId: string; intent: RelinkIntent;
		original: MediaTechnicalMetadata; requiredSourceEnd: number;
		originalFingerprint?: string | null; fingerprintVersion?: string | null;
		candidateHandle: PermissionFileHandle; operationId?: string;
	}): Promise<RelinkInspection> => {
		const operationId = input.operationId ?? crypto.randomUUID();
		latest.set(input.resourceId, operationId);
		const file = await input.candidateHandle.getFile();
		const candidate = await deps.probe(file);
		let fingerprint: string | null = null; let fingerprintVersion: string | null = null;
		try { const result = await deps.fingerprint(file); fingerprint = result.fingerprint; fingerprintVersion = result.version; } catch { /* identity remains unknown */ }
		const old = await deps.handles.get(input.resourceId);
		let sameEntry = false;
		try { sameEntry = Boolean(old?.handle && input.candidateHandle.isSameEntry && await input.candidateHandle.isSameEntry(old.handle)); } catch { /* no evidence */ }
		const identity = sameEntry ? "same-entry" : fingerprint && input.originalFingerprint && fingerprintVersion === input.fingerprintVersion && fingerprint === input.originalFingerprint ? "fingerprint-match" : fingerprint && input.originalFingerprint ? "mismatch" : "metadata-only";
		let policy = evaluateRelinkCandidate({ original: input.original, candidate, requiredSourceEnd: input.requiredSourceEnd, identity });
		if (input.intent === "locate-original" && policy.classification !== "exact-match") policy = { ...policy, classification: "incompatible", requiresConfirmation: false };
		const confirmationToken = policy.classification === "compatible-replacement" ? crypto.randomUUID() : null;
		const inspection = { operationId, intent: input.intent, policy, candidate, confirmationToken };
		pending.set(operationId, { ...inspection, resourceId: input.resourceId, projectId: input.projectId, candidateValue: { handle: input.candidateHandle, file }, fingerprint, fingerprintVersion });
		return inspection;
	};

	const commitResourceRelink = async (operationId: string, confirmationToken?: string): Promise<RelinkCommitResult> => {
		const item = pending.get(operationId);
		if (!item || latest.get(item.resourceId) !== operationId) return { ok: false, reason: "stale-operation" };
		if (item.policy.classification === "incompatible") return { ok: false, reason: "incompatible" };
		if (item.policy.requiresConfirmation && confirmationToken !== item.confirmationToken) return { ok: false, reason: "confirmation-required" };
		const oldHandle = await deps.handles.get(item.resourceId);
		const oldAsset = await deps.assets.getFile(item.projectId, item.resourceId);
		const asset = await deps.assets.putFromFile(item.projectId, item.resourceId, item.candidateValue.file, { relinkOperationId: operationId }, { operationId });
		if (!asset.ok) return { ok: false, reason: "storage-error" };
		const now = deps.now();
		try {
			await deps.handles.put({ resourceId: item.resourceId, handle: item.candidateValue.handle, name: item.candidateValue.file.name, size: item.candidateValue.file.size, lastModified: item.candidateValue.file.lastModified, mime: item.candidateValue.file.type || "application/octet-stream", createdAt: oldHandle?.createdAt ?? now, updatedAt: now });
		} catch {
			if (oldAsset) await deps.assets.putFromFile(item.projectId, item.resourceId, oldAsset, {}, { operationId: `${operationId}-rollback` });
			else await deps.assets.deleteResource(item.projectId, item.resourceId);
			return { ok: false, reason: "storage-error" };
		}
		const url = deps.createObjectUrl(item.candidateValue.file);
		if (!url) return { ok: false, reason: "storage-error" };
		try {
			await deps.complete({ resourceId: item.resourceId, operationId, url, assetStorageKind: "project-copy", assetRef: asset.assetRef, contentFingerprint: item.fingerprint, fingerprintVersion: item.fingerprintVersion, ...item.candidate });
		} catch {
			deps.revokeObjectUrl(url);
			if (oldHandle) await deps.handles.put(oldHandle); else await deps.handles.delete(item.resourceId);
			if (oldAsset) await deps.assets.putFromFile(item.projectId, item.resourceId, oldAsset, {}, { operationId: `${operationId}-rollback` }); else await deps.assets.deleteResource(item.projectId, item.resourceId);
			return { ok: false, reason: "completion-error" };
		}
		if (latest.get(item.resourceId) !== operationId) { deps.revokeObjectUrl(url); return { ok: false, reason: "stale-operation" }; }
		deps.activate(item.resourceId, url);
		pending.delete(operationId);
		return { ok: true };
	};
	return { inspectRelinkCandidate, commitResourceRelink };
};
