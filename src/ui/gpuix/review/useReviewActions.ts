import { createOneFor, useRootScope, useScopeRuntime } from "../../../dkt-solid-sync";
import {
	REVIEW_APP_MODEL_REL,
	reviewActionScopeForItem,
	warnReviewAppModelMissing,
} from "../../../video-editor/components/review/reviewActionRouting";
import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";

/**
 * Sends review actions the way Web's ProjectReviewMode does: an item action
 * goes to the scope named by `item.actionTargets[actionId]`, with the conflict
 * and item ids merged into the payload built by the feature inspector;
 * acknowledging goes to the app model (see REVIEW_APP_MODEL_REL). All domain handling is in the model.
 */
export const useReviewActions = () => {
	const runtime = useScopeRuntime();
	const appModel = createOneFor(runtime, useRootScope(), REVIEW_APP_MODEL_REL);
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
			const scope = appModel();
			if (!scope) {
				warnReviewAppModelMissing("acknowledgeReviewItem");
				return;
			}
			runtime.getDispatch(scope)("acknowledgeReviewItem", {
				conflict_id: item.conflictId,
				review_item_id: item.id,
			});
		},
	};
};

export type ReviewActions = ReturnType<typeof useReviewActions>;
