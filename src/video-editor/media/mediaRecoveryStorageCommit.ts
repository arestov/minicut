import type { LocalMediaHandleRecord, LocalMediaHandleVersionRef, createLocalMediaHandleStore } from "./localMediaHandleStore";
import type { ProjectAssetMetadata, ProjectAssetStore, ProjectAssetVersionRef } from "./projectAssetStore";

type HandleStore = ReturnType<typeof createLocalMediaHandleStore>;
export type RecoveryPublishOutcome = "applied" | "noop" | "error";
export type RecoveryStorageFaultPoint = "before-stage" | "after-asset-stage" | "after-handle-stage" | "after-validation" | "after-pointer-switch";
export type RecoveryStorageCommitResult =
	| { ok: true; assetRef: ProjectAssetVersionRef | null; handleRef: LocalMediaHandleVersionRef; linkedFallback: boolean }
	| { ok: false; reason: "asset-stage" | "handle-stage" | "validation" | "stale" | "publish" | "interrupted"; error?: unknown };

export const commitRecoveryStorage = async (input: {
	projectId: string;
	resourceId: string;
	operationId: string;
	file: File;
	handleRecord: LocalMediaHandleRecord;
	assetMetadata: ProjectAssetMetadata;
	assets: ProjectAssetStore;
	handles: HandleStore;
	publish: (refs: { assetRef: ProjectAssetVersionRef | null; handleRef: LocalMediaHandleVersionRef; linkedFallback: boolean }) => Promise<RecoveryPublishOutcome>;
	fault?: (point: RecoveryStorageFaultPoint) => void | Promise<void>;
}): Promise<RecoveryStorageCommitResult> => {
	let stagedAsset: ProjectAssetVersionRef | null = null;
	let stagedHandle: LocalMediaHandleVersionRef | null = null;
	let pointerSwitched = false;
	try {
		await input.fault?.("before-stage");
		const asset = await input.assets.stage(input.projectId, input.resourceId, input.operationId, input.file, input.assetMetadata);
		const linkedFallback = !asset.ok && (asset.reason === "quota-exceeded" || asset.reason === "unavailable");
		if (!asset.ok && !linkedFallback) return { ok: false, reason: "asset-stage", error: asset.error };
		if (asset.ok) stagedAsset = asset.assetRef;
		await input.fault?.("after-asset-stage");
		stagedHandle = await input.handles.stage(input.projectId, input.resourceId, input.operationId, input.handleRecord);
		await input.fault?.("after-handle-stage");
		if ((stagedAsset && !await input.assets.validate(stagedAsset)) || !await input.handles.validate(stagedHandle)) {
			throw Object.assign(new Error("Staged recovery media failed validation"), { recoveryReason: "validation" });
		}
		await input.fault?.("after-validation");
		const refs = { assetRef: stagedAsset, handleRef: stagedHandle, linkedFallback };
		const outcome = await input.publish(refs);
		if (outcome !== "applied") {
			if (stagedAsset) await input.assets.rollback(stagedAsset);
			await input.handles.rollback(stagedHandle);
			return { ok: false, reason: outcome === "noop" ? "stale" : "publish" };
		}
		pointerSwitched = true;
		await input.fault?.("after-pointer-switch");
		if (stagedAsset) await input.assets.cleanup(input.projectId, input.resourceId, stagedAsset);
		await input.handles.cleanup(input.resourceId, stagedHandle);
		return { ok: true, ...refs };
	} catch (error) {
		if (!pointerSwitched) {
			if (stagedAsset) await input.assets.rollback(stagedAsset).catch(() => undefined);
			if (stagedHandle) await input.handles.rollback(stagedHandle).catch(() => undefined);
		}
		return { ok: false, reason: (error as { recoveryReason?: string })?.recoveryReason === "validation" ? "validation" : "interrupted", error };
	}
};
