import { useMemo } from "react";
import type {
	MiniCutActivitySummary,
	MiniCutReviewItem,
} from "../../dkt/review/types";
import { ActivitySummaryPanel } from "./ActivitySummaryPanel";
import { ConflictInspectorPanel } from "./ConflictInspectorPanel";
import { ReviewItemList } from "./ReviewItemList";

type ReviewPanelProps = {
	items: MiniCutReviewItem[];
	activitySummaries?: MiniCutActivitySummary[];
	selectedItemId?: string | null;
	onSelectReviewItem?: (item: MiniCutReviewItem) => void;
	onAcknowledgeReviewItem?: (item: MiniCutReviewItem) => void;
	onReviewAction?: (actionId: string, item: MiniCutReviewItem) => void;
	onClose?: () => void;
};

export const ReviewPanel = ({
	items,
	activitySummaries = [],
	selectedItemId,
	onSelectReviewItem,
	onAcknowledgeReviewItem,
	onReviewAction,
	onClose,
}: ReviewPanelProps) => {
	const selectedItem = useMemo(
		() => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null,
		[items, selectedItemId],
	);
	const openCount = items.filter((item) => item.status !== "resolved").length;

	return (
		<section className="ve-review-panel" aria-label="Project review">
			<header className="ve-review-panel__header">
				<div>
					<h2>Project review</h2>
					<span>
						{openCount} open / {items.length} total
					</span>
				</div>
			</header>
			<div className="ve-review-panel__body">
				<ReviewItemList
					items={items}
					selectedItemId={selectedItem?.id ?? null}
					onSelectReviewItem={onSelectReviewItem}
				/>
				<ConflictInspectorPanel
					item={selectedItem}
					onAcknowledgeReviewItem={onAcknowledgeReviewItem}
					onReviewAction={onReviewAction}
					onClose={onClose}
				/>
				<ActivitySummaryPanel summaries={activitySummaries} />
			</div>
		</section>
	);
};
