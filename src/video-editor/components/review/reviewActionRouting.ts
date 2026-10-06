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
