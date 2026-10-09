import { useMemo } from "react";
import {
	REVIEW_STATUS_FILTERS,
	type ReviewStatusFilter,
} from "../../dkt/review/reviewFilters";
import type {
	MiniCutActivitySummary,
	MiniCutReviewItem,
} from "../../dkt/review/types";
import { ActivitySummaryPanel } from "./ActivitySummaryPanel";
import { ConflictInspectorPanel } from "./ConflictInspectorPanel";
import { ReviewItemList } from "./ReviewItemList";

const STATUS_FILTER_LABELS: Record<ReviewStatusFilter, string> = {
	unresolved: "Unresolved",
	resolved: "Resolved",
	all: "All",
};

type ReviewPanelProps = {
	/** Every review item of the project (counts, selection, inspector). */
	items: MiniCutReviewItem[];
	/** The items the list shows: the model's filtered list (defaults to items). */
	listItems?: MiniCutReviewItem[];
	statusFilter?: ReviewStatusFilter;
	onStatusFilterChange?: (status: ReviewStatusFilter) => void;
	activitySummaries?: MiniCutActivitySummary[];
	selectedItemId?: string | null;
	onSelectReviewItem?: (item: MiniCutReviewItem) => void;
	onAcknowledgeReviewItem?: (item: MiniCutReviewItem) => void;
	onReviewAction?: (
		actionId: string,
		item: MiniCutReviewItem,
		payload?: unknown,
	) => void;
	onClose?: () => void;
};

export const ReviewPanel = ({
	items,
	listItems = items,
	statusFilter,
	onStatusFilterChange,
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
				{statusFilter ? (
					<div
						className="ve-review-panel__filter"
						role="group"
						aria-label="Review status filter"
					>
						{REVIEW_STATUS_FILTERS.map((status) => (
							<button
								key={status}
								type="button"
								aria-pressed={status === statusFilter}
								onClick={() => onStatusFilterChange?.(status)}
							>
								{STATUS_FILTER_LABELS[status]}
							</button>
						))}
					</div>
				) : null}
			</header>
			<div className="ve-review-panel__body">
				<ReviewItemList
					items={listItems}
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
