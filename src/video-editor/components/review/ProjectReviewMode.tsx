import { useEffect, useMemo, useState } from "react";
import { useAttrs } from "../../../dkt-react-sync/hooks/useAttrs";
import { useReactScopeRuntime } from "../../../dkt-react-sync/hooks/useReactScopeRuntime";
import type { ActiveProjectReviewSnapshot } from "../../models/SessionRoot/comps";
import { ReviewPanel } from "./ReviewPanel";

const isReviewSnapshot = (
	value: unknown,
): value is ActiveProjectReviewSnapshot =>
	Boolean(
		value &&
			typeof value === "object" &&
			"session" in value &&
			"openCount" in value,
	);

export const ProjectReviewMode = () => {
	const runtime = useReactScopeRuntime();
	const { activeProjectReviewSnapshot } = useAttrs([
		"activeProjectReviewSnapshot",
	]) as { activeProjectReviewSnapshot?: unknown };
	const [isOpen, setIsOpen] = useState(false);
	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
	const review = useMemo(
		() =>
			isReviewSnapshot(activeProjectReviewSnapshot)
				? activeProjectReviewSnapshot
				: { session: null, openCount: 0 },
		[activeProjectReviewSnapshot],
	);
	const session = review.session;

	useEffect(() => {
		if (review.openCount > 0) {
			setIsOpen(true);
		}
	}, [review.openCount]);

	useEffect(() => {
		setSelectedItemId(session?.selectedReviewItemId ?? session?.items[0]?.id ?? null);
	}, [session?.id, session?.selectedReviewItemId, session?.items[0]?.id]);

	if (
		!session ||
		(session.items.length === 0 && session.activitySummaries.length === 0)
	) {
		return null;
	}

	return (
		<>
			<button
				type="button"
				className="ve-project-review-trigger"
				aria-label={review.openCount > 0 ? `Review ${review.openCount}` : "Review"}
				onClick={() => setIsOpen(true)}
			>
				Review
				{review.openCount > 0 ? <span> {review.openCount}</span> : null}
			</button>
			{isOpen ? (
				<div className="ve-project-review-drawer">
					<ReviewPanel
						items={session.items}
						activitySummaries={session.activitySummaries}
						selectedItemId={selectedItemId ?? session.selectedReviewItemId}
						onSelectReviewItem={(item) => setSelectedItemId(item.id)}
						onClose={() => setIsOpen(false)}
						onAcknowledgeReviewItem={(item) =>
							runtime.dispatchAction("acknowledgeReviewItem", {
								conflict_id: item.conflictId,
								review_item_id: item.id,
							})
						}
						onReviewAction={(actionId, item) => {
							const affectedClip = item.affectedObjects.find(
								(object) => object.type === "clip",
							);
							runtime.dispatchAction(
								actionId,
								{
									conflict_id: item.conflictId,
									review_item_id: item.id,
								},
								affectedClip
									? { kind: "scope", _nodeId: affectedClip.id }
									: null,
							);
						}}
					/>
				</div>
			) : null}
		</>
	);
};
