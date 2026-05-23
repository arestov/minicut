import type { MiniCutReviewItem } from "../../dkt/review/types";

type ReviewItemListProps = {
	items: MiniCutReviewItem[];
	selectedItemId?: string | null;
	onSelectReviewItem?: (item: MiniCutReviewItem) => void;
};

export const ReviewItemList = ({
	items,
	selectedItemId,
	onSelectReviewItem,
}: ReviewItemListProps) => (
	<ul className="ve-review-item-list" aria-label="Review items">
		{items.map((item) => (
			<li key={item.id}>
				<button
					type="button"
					className={item.id === selectedItemId ? "is-selected" : undefined}
					aria-pressed={item.id === selectedItemId}
					onClick={() => onSelectReviewItem?.(item)}
				>
					<span>{item.title}</span>
					<small>{item.status}</small>
				</button>
			</li>
		))}
	</ul>
);

