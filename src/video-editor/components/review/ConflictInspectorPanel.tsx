import { Check, Info, X } from "lucide-react";
import type { MiniCutReviewItem } from "../../dkt/review/types";

type ConflictInspectorPanelProps = {
	item: MiniCutReviewItem | null;
	onClose?: () => void;
	onAcknowledgeReviewItem?: (item: MiniCutReviewItem) => void;
	onReviewAction?: (actionId: string, item: MiniCutReviewItem) => void;
};

const previewLabel = (preview: unknown): string => {
	if (!preview || typeof preview !== "object") {
		return "No preview available";
	}
	const type = (preview as { type?: unknown }).type;
	return typeof type === "string" ? type.replaceAll("_", " ") : "Review preview";
};

const actionLabel = (actionId: string): string =>
	actionId === "resolveClipTimingConflict"
		? "Use suggested timing"
		: actionId.replace(/([a-z])([A-Z])/g, "$1 $2");

export const ConflictInspectorPanel = ({
	item,
	onClose,
	onAcknowledgeReviewItem,
	onReviewAction,
}: ConflictInspectorPanelProps) => (
	<section className="ve-review-inspector" aria-label="Conflict inspector">
		<header>
			<h2>Review inspector</h2>
			{onClose ? (
				<button type="button" title="Close" aria-label="Close" onClick={onClose}>
					<X aria-hidden="true" size={16} />
				</button>
			) : null}
		</header>
		{item ? (
			<>
				<div className="ve-review-inspector__summary">
					<Info aria-hidden="true" size={16} />
					<div>
						<strong>{item.title}</strong>
						<span>{previewLabel(item.preview)}</span>
					</div>
				</div>
				<dl className="ve-review-inspector__meta">
					<div>
						<dt>Status</dt>
						<dd>{item.status}</dd>
					</div>
					<div>
						<dt>Kind</dt>
						<dd>{item.kind.replaceAll("_", " ")}</dd>
					</div>
					<div>
						<dt>Conflict</dt>
						<dd>{item.conflictId}</dd>
					</div>
				</dl>
				{item.affectedObjects.length > 0 ? (
					<ul aria-label="Affected objects">
						{item.affectedObjects.map((object) => (
							<li key={`${object.type}:${object.id}`}>
								<span>{object.label ?? object.type}</span>
								<small>{object.id}</small>
							</li>
						))}
					</ul>
				) : null}
				<div className="ve-review-inspector__actions">
					{item.availableActions.map((actionId) => (
						<button
							key={actionId}
							type="button"
							onClick={() => onReviewAction?.(actionId, item)}
						>
							<Check aria-hidden="true" size={16} />
							{actionLabel(actionId)}
						</button>
					))}
					<button
						type="button"
						onClick={() => onAcknowledgeReviewItem?.(item)}
					>
						<Check aria-hidden="true" size={16} />
						Acknowledge
					</button>
				</div>
			</>
		) : (
			<p>No review item selected</p>
		)}
	</section>
);
