import type { ImportExecutor } from "./importExecutor";
import type { MediaRecoveryExecutor } from "./mediaRecoveryExecutor";
import type { ResourceAssetIndex } from "./resourceAssetIndex";

/**
 * Temporary host driver until the model carries sourceKind/sourceRef in
 * recovery payloads and plan clipSources and schedules boot restore itself
 * (model gap M10).
 *
 * Starts the automatic restore (`startMediaRecovery`, intent restore) once per
 * boot for every resource that already had a local asset when it first showed
 * up in the active project, like the Web page does after hydration. Resources
 * created by an import in this process run their own import recovery and are
 * skipped. The verdict (file reachable or `source-missing`) comes from the
 * recovery executor.
 */
export const createRestoreDriver = ({
	index,
	recovery,
	imports,
	bootId,
}: {
	index: Pick<ResourceAssetIndex, "entries" | "subscribe">;
	recovery: Pick<MediaRecoveryExecutor, "requestRestore">;
	imports: Pick<ImportExecutor, "importedAssetIds">;
	bootId: string;
}): { dispose(): void } => {
	const started = new Set<string>();
	const check = (): void => {
		for (const [resourceId, assetId] of index.entries()) {
			if (started.has(resourceId)) continue;
			started.add(resourceId);
			if (imports.importedAssetIds.has(assetId)) continue;
			recovery.requestRestore(resourceId, bootId);
		}
	};
	const stop = index.subscribe(check);
	check();
	return { dispose: stop };
};
