import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { MiniCutReviewItem } from "../../dkt/review/types";

export const reviewActionScopeForItem = (
	item: MiniCutReviewItem,
	actionId: string,
): ReactSyncScopeHandle | null => {
	const target = item.actionTargets[actionId];
	if (!target) {
		return null;
	}
	return { kind: "scope", _nodeId: target.id };
};


/**
 * Generic review actions (`acknowledgeReviewItem`) are owned by the app model,
 * not by an item's actionTargets. The UI reaches it from the root (session)
 * scope through this rel; the session root has no handler for them.
 */
export const REVIEW_APP_MODEL_REL = "pioneer";

/** Acknowledge cannot be sent before the app model scope is loaded; say so. */
export const warnReviewAppModelMissing = (actionName: string) => {
	console.warn(
		`[review] ${actionName} not sent: the app model (root rel "${REVIEW_APP_MODEL_REL}") is not loaded`,
	);
};
