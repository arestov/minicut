import { useScopeRuntime } from "../../../dkt-solid-sync";
import { reviewActionScopeForItem } from "../../../video-editor/components/review/reviewActionRouting";
import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";

/**
 * Sends review actions the way Web's ProjectReviewMode does: an item action
 * goes to the scope named by `item.actionTargets[actionId]`, with the conflict
 * and item ids merged into the payload built by the feature inspector;
 * acknowledging goes to the root. All domain handling is in the model.
 */
export const useReviewActions = () => {
	const runtime = useScopeRuntime();
	return {
		act(item: MiniCutReviewItem, actionId: string, payload?: unknown) {
			const scope = reviewActionScopeForItem(item, actionId);
			if (!scope) return;
			runtime.getDispatch(scope)(actionId, {
				conflict_id: item.conflictId,
				review_item_id: item.id,
				...(payload && typeof payload === "object" ? payload : {}),
			});
		},
		acknowledge(item: MiniCutReviewItem) {
			runtime.getDispatch(null)("acknowledgeReviewItem", {
				conflict_id: item.conflictId,
				review_item_id: item.id,
			});
		},
	};
};

export type ReviewActions = ReturnType<typeof useReviewActions>;
