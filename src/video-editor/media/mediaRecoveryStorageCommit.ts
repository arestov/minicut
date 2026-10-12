import type { LocalMediaHandleRecord, LocalMediaHandleVersionRef, createLocalMediaHandleStore } from "./localMediaHandleStore";
import type { ProjectAssetMetadata, ProjectAssetStore, ProjectAssetVersionRef } from "./projectAssetStore";
import type { AcceptedPublication } from "./mediaPublicationProtocol";

type HandleStore = ReturnType<typeof createLocalMediaHandleStore>;
export type RecoveryPublishOutcome = { kind: "accepted"; receipt: AcceptedPublication } | { kind: "rejected"; candidateDisposition: "rollback-unaccepted" | "retain-uncertain" } | { kind: "indeterminate"; reason: string };
export type RecoveryStorageFaultPoint = "before-stage" | "after-asset-stage" | "after-handle-stage" | "after-validation" | "after-pointer-switch";
type RecoveryRefs = { assetRef: ProjectAssetVersionRef | null; handleRef: LocalMediaHandleVersionRef | null; linkedFallback: boolean };
export type RecoveryStorageCommitResult = RecoveryRefs & (
	{ ok: true; publication: RecoveryPublishOutcome } | { ok: false; reason: "asset-stage" | "handle-stage" | "validation" | "stale" | "publish" | "interrupted"; error?: unknown; publication?: RecoveryPublishOutcome }
);

export const commitRecoveryStorage = async (input: {
	projectId: string; resourceId: string; operationId: string; file: File;
	handleRecord: LocalMediaHandleRecord | null; assetMetadata: ProjectAssetMetadata;
	assets: ProjectAssetStore; handles: HandleStore;
	publish(refs: RecoveryRefs): Promise<RecoveryPublishOutcome>;
	fault?(point: RecoveryStorageFaultPoint): void | Promise<void>;
}): Promise<RecoveryStorageCommitResult> => {
	let assetRef: ProjectAssetVersionRef | null = null;
	let handleRef: LocalMediaHandleVersionRef | null = null;
	let linkedFallback = false;
	let dispatchStarted = false;
	let publication: RecoveryPublishOutcome | undefined;
	const refs = (): RecoveryRefs => ({ assetRef, handleRef, linkedFallback });
	const rollback = async () => { try { if (assetRef) await input.assets.rollback(assetRef); } finally { if (handleRef) await input.handles.rollback(handleRef); } };
	// Protection is acquired before the first stage/fault await and checked by each existing store deletion.
	input.assets.protectPublicationResource(input.projectId, input.resourceId);
	input.handles.protectPublicationResource(input.resourceId);
	try {
		await input.fault?.("before-stage");
		const asset = await input.assets.stage(input.projectId, input.resourceId, input.operationId, input.file, input.assetMetadata);
		linkedFallback = !asset.ok && (asset.reason === "quota-exceeded" || asset.reason === "unavailable");
		if (!asset.ok && !linkedFallback) return { ok: false, reason: "asset-stage", error: asset.error, ...refs() };
		if (asset.ok) assetRef = asset.assetRef;
		await input.fault?.("after-asset-stage");
		if (input.handleRecord) handleRef = await input.handles.stage(input.projectId, input.resourceId, input.operationId, input.handleRecord);
		await input.fault?.("after-handle-stage");
		if ((assetRef && !await input.assets.validate(assetRef)) || (handleRef && !await input.handles.validate(handleRef))) throw Object.assign(new Error("Staged recovery media failed validation"), { recoveryReason: "validation" });
		await input.fault?.("after-validation");
		dispatchStarted = true;
		publication = await input.publish(refs());
		if (publication.kind === "rejected" && publication.candidateDisposition === "rollback-unaccepted") { await rollback(); return { ok: false, reason: "stale", publication, ...refs() }; }
		await input.fault?.("after-pointer-switch");
		return { ok: true, publication, ...refs() };
	} catch (error) {
		if (dispatchStarted) return { ok: true, publication: publication?.kind === "accepted" ? publication : { kind: "indeterminate", reason: "publication-dispatch-unknown" }, ...refs() };
		try { await rollback(); } catch { /* Exact unaccepted cleanup can be retried by its owner. */ }
		return { ok: false, reason: (error as { recoveryReason?: string })?.recoveryReason === "validation" ? "validation" : "interrupted", error, ...refs() };
	}
};
