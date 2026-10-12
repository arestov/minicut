/** Serial publication protocol. Resource is currentness authority; host objects stay outside this module. */
export type PublicationTuple = { projectId: string; resourceId: string; taskId: string; operationId: string; attemptId: string; bootId: string; runtimeHandleId: string | null };
export type PublicationCandidate = { candidateMetadata: Record<string, unknown>; candidateFingerprint: string | null; candidateFingerprintVersion: string | null };
export type PublicationPointer = { assetStorageKind: "project-copy" | "linked"; assetRef: string | null; sourceKind: string; sourceRef: string | null; url: string; contentFingerprint: string | null; fingerprintVersion: string | null; duration: number; width: number | null; height: number | null; localMediaAvailability: string; originalAccessStatus: string };
export type PublicationProposal = PublicationTuple & PublicationCandidate & { pointer: PublicationPointer; candidateFileMetadata: { mime: string; size: number | null; lastModified: number | null }; updatedAt: number };
export type AcceptedPublication = PublicationProposal & { kind: "accepted"; sequence: number; acceptedResource: Record<string, unknown>; previousAcceptedIdentityAndRefs: (PublicationTuple & { sequence: number; pointer: PublicationPointer }) | null };
export type PublicationDecision = { decision: AcceptedPublication; bindingEligibility: "current" | "obsolete" } | (PublicationTuple & { kind: "rejected"; reason: string; candidateDisposition: "rollback-unaccepted" | "retain-uncertain" });
export type PublicationBindingResult = PublicationTuple & { sequence: number; candidateFingerprint: string | null; candidateFingerprintVersion: string | null; outcome: "installed" | "obsolete" | "indeterminate" | "rejected"; boundaryUpdatedAt: number; reason?: string };
export type PublicationOwnership = PublicationTuple & { accepted: AcceptedPublication | null; pointer: PublicationPointer | null; assetRef: string | null; handleRef: string | null; currentBacking?: { projectId: string; assetRef: string | null; handleRef: string | null } | null; eligible: boolean };
export type PublicationManifest = { accepted: PublicationOwnership[]; candidates: PublicationOwnership[] };
export type PublicationRetirement = PublicationOwnership & { sequence: number | null; releaseTransferToken: string | null; releasePlaybackToken: string | null; disposition: "unaccepted" | "no-longer-current"; reason: string; excludedAssetRef: string | null; excludedHandleRef: string | null };

const tupleKeys = ["projectId", "resourceId", "taskId", "operationId", "attemptId", "bootId", "runtimeHandleId"] as const;
export const recordOf = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Refuse host capabilities, undefined members and nonfinite numbers before making an owned serial copy. */
export const copyPublicationValue = (value: unknown): unknown => {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.map(copyPublicationValue);
	const object = recordOf(value);
	if (!object || (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null)) throw new Error("Nonserial publication value");
	return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, copyPublicationValue(entry)]));
};
export const publicationTuple = (value: unknown): PublicationTuple | null => {
	const object = recordOf(value);
	if (!object || tupleKeys.slice(0, 6).some((key) => typeof object[key] !== "string" || !object[key]) || !(object.runtimeHandleId === null || typeof object.runtimeHandleId === "string" && object.runtimeHandleId.length > 0)) return null;
	return Object.fromEntries(tupleKeys.map((key) => [key, object[key]])) as PublicationTuple;
};
export const samePublicationTuple = (left: unknown, right: unknown): boolean => {
	const a = publicationTuple(left); const b = publicationTuple(right);
	return Boolean(a && b && tupleKeys.every((key) => a[key] === b[key]));
};
export const samePublicationValue = (left: unknown, right: unknown): boolean => {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => samePublicationValue(value, right[index]));
	const a = recordOf(left); const b = recordOf(right);
	return Boolean(a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && samePublicationValue(a[key], b[key])));
};
export const samePublicationCandidate = (left: unknown, right: unknown): boolean => {
	const a = recordOf(left); const b = recordOf(right);
	return Boolean(a && b && samePublicationTuple(a, b) && samePublicationValue(a.candidateMetadata, b.candidateMetadata) && a.candidateFingerprint === b.candidateFingerprint && a.candidateFingerprintVersion === b.candidateFingerprintVersion);
};
export const publicationProposal = (value: unknown): PublicationProposal | null => {
	const object = recordOf(value); const tuple = publicationTuple(object); const pointer = recordOf(object?.pointer); const metadata = recordOf(object?.candidateMetadata); const file = recordOf(object?.candidateFileMetadata);
	if (!object || !tuple || !pointer || !metadata || !file || typeof object.updatedAt !== "number" || !Number.isFinite(object.updatedAt)) return null;
	const nullableString = (entry: unknown) => entry === null || typeof entry === "string";
	if (![object.candidateFingerprint, object.candidateFingerprintVersion, pointer.assetRef, pointer.sourceRef, pointer.contentFingerprint, pointer.fingerprintVersion].every(nullableString) || !["project-copy", "linked"].includes(String(pointer.assetStorageKind)) || typeof pointer.sourceKind !== "string" || !pointer.sourceKind || typeof pointer.url !== "string" || typeof pointer.localMediaAvailability !== "string" || typeof pointer.originalAccessStatus !== "string" || typeof pointer.duration !== "number" || !Number.isFinite(pointer.duration) || pointer.duration < 0 || ![pointer.width, pointer.height].every((entry) => entry === null || typeof entry === "number" && Number.isFinite(entry) && entry >= 0) || typeof file.mime !== "string" || !file.mime || ![file.size, file.lastModified].every((entry) => entry === null || typeof entry === "number" && Number.isFinite(entry) && entry >= 0)) return null;
	if (pointer.assetStorageKind === "project-copy" && (typeof pointer.assetRef !== "string" || !pointer.assetRef)) return null;
	try {
		return { ...tuple, candidateMetadata: copyPublicationValue(metadata) as Record<string, unknown>, candidateFingerprint: object.candidateFingerprint as string | null, candidateFingerprintVersion: object.candidateFingerprintVersion as string | null, pointer: Object.fromEntries(["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "url", "contentFingerprint", "fingerprintVersion", "duration", "width", "height", "localMediaAvailability", "originalAccessStatus"].map((key) => [key, copyPublicationValue(pointer[key])])) as PublicationPointer, candidateFileMetadata: { mime: file.mime, size: file.size as number | null, lastModified: file.lastModified as number | null }, updatedAt: object.updatedAt };
	} catch { return null; }
};
export const publicationState = (...values: unknown[]) => Object.fromEntries(["taskId", "operationId", "attemptId", "bootId", "runtimeHandleId", "phase", "candidateMetadata", "candidateFingerprint", "candidateFingerprintVersion", "publicationRequested", "publicationReceipt", "stagedAssetRef", "stagedHandleRef", "removed", "outcome"].map((key, index) => [key, key === "runtimeHandleId" ? values[index] ?? null : values[index]]));
export const PUBLICATION_STATE_DEPS = ["_node_id", "operationId", "attemptId", "bootId", "runtimeHandleId", "phase", "candidateMetadata", "candidateFingerprint", "candidateFingerprintVersion", "publicationRequested", "publicationReceipt", "stagedAssetRef", "stagedHandleRef", "$meta$removed", "outcome"] as const;
export const emptyPublicationManifest = (): PublicationManifest => ({ accepted: [], candidates: [] });
export const makePublicationManifest = (accepted: unknown, candidates: unknown): PublicationManifest => ({ accepted: Array.isArray(accepted) ? accepted.filter(Boolean).map((value) => copyPublicationValue(value) as PublicationOwnership) : [], candidates: Array.isArray(candidates) ? candidates.filter(Boolean).map((value) => copyPublicationValue(value) as PublicationOwnership) : [] });
const owns = (item: PublicationOwnership, other: PublicationOwnership) => samePublicationTuple(item, other) && (item.accepted?.sequence ?? null) === (other.accepted?.sequence ?? null) && samePublicationValue(item.pointer, other.pointer);
export const publicationRetirements = (previous: PublicationManifest | null | undefined, next: PublicationManifest | null | undefined): PublicationRetirement[] => {
	const before = previous ?? emptyPublicationManifest(); const after = next ?? emptyPublicationManifest();
	const current = after.accepted.filter((item) => item.eligible);
	const retired = [...before.accepted.filter((item) => !current.some((other) => owns(item, other))), ...before.candidates.filter((item) => !after.candidates.some((other) => other.eligible && samePublicationTuple(item, other)) && !current.some((other) => samePublicationTuple(item, other)))];
	return retired.map((item) => { const pointed = after.accepted.find((other) => other.resourceId === item.resourceId); const replacement = pointed && Object.hasOwn(pointed, "currentBacking") ? pointed.currentBacking : current.find((other) => other.resourceId === item.resourceId); return { ...item, sequence: item.accepted?.sequence ?? null, releaseTransferToken: item.accepted ? publicationIdentity(item, item.accepted.sequence) : null, releasePlaybackToken: item.accepted ? publicationIdentity(item, item.accepted.sequence) : null, disposition: item.accepted ? "no-longer-current" : "unaccepted", reason: "publication-no-longer-owned", excludedAssetRef: replacement?.assetRef ?? null, excludedHandleRef: replacement?.handleRef ?? null }; });
};
/** Captured map entries, never queried task.values, authorize historical retirement. */
export const capturedPublicationRetirements = (state: unknown): PublicationRetirement[] => {
	const task = recordOf(state); const prev = recordOf(task?.prev_values); const next = recordOf(task?.next_values);
	const hasPrev = Boolean(prev && Object.hasOwn(prev, "localMediaPublicationManifest")); const hasNext = Boolean(next && Object.hasOwn(next, "localMediaPublicationManifest"));
	if (hasPrev !== hasNext) throw new Error("One-sided media publication manifest capture; retain ownership");
	if (!hasPrev) return [];
	return publicationRetirements(copyPublicationValue(prev!.localMediaPublicationManifest ?? null) as PublicationManifest | null, copyPublicationValue(next!.localMediaPublicationManifest ?? null) as PublicationManifest | null);
};

export const publicationIdentity = (value: unknown, sequence: number): string => JSON.stringify([publicationTuple(value), sequence]);
export const acceptedPublication = (value: unknown): AcceptedPublication | null => {
	const raw = recordOf(value); const proposal = publicationProposal(raw); const resource = recordOf(raw?.acceptedResource);
	if (!raw || !proposal || raw.kind !== "accepted" || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1 || !resource || resource.resourceId !== proposal.resourceId || resource.projectId !== proposal.projectId || typeof resource.name !== "string" || !["video", "audio", "image", "text"].includes(String(resource.kind)) || typeof resource.status !== "string" || !recordOf(resource.source) || !recordOf(resource.data)) return null;
	if (!Object.entries({ ...proposal.pointer, ...proposal.candidateFileMetadata }).every(([key, entry]) => samePublicationValue(resource[key], entry))) return null;
	try {
		let previous: AcceptedPublication["previousAcceptedIdentityAndRefs"] = null;
		if (raw.previousAcceptedIdentityAndRefs !== null) {
			const old = recordOf(raw.previousAcceptedIdentityAndRefs); const tuple = publicationTuple(old);
			const oldPointer = old && tuple ? publicationProposal({ ...proposal, ...tuple, pointer: old.pointer })?.pointer : null;
			if (!old || !tuple || !oldPointer || tuple.resourceId !== proposal.resourceId || !Number.isSafeInteger(old.sequence) || (old.sequence as number) < 1 || (old.sequence as number) >= (raw.sequence as number)) return null;
			previous = { ...tuple, sequence: old.sequence as number, pointer: oldPointer };
		}
		const acceptedResource = copyPublicationValue({ projectId: resource.projectId, resourceId: resource.resourceId, name: resource.name, kind: resource.kind, status: resource.status, source: resource.source, data: resource.data, ...proposal.pointer, ...proposal.candidateFileMetadata }) as Record<string, unknown>;
		return { ...proposal, kind: "accepted", sequence: raw.sequence as number, acceptedResource, previousAcceptedIdentityAndRefs: previous };
	} catch { return null; }
};
