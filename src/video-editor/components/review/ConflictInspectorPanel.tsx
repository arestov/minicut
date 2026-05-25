import { Check, Info, X } from "lucide-react";
import type { MiniCutReviewItem } from "../../dkt/review/types";
import { ClipTimingConflictInspector } from "./features/ClipTimingConflictInspector";
import { TrackOrderInspector } from "./features/TrackOrderInspector";
import { DeleteVsEditInspector } from "./features/DeleteVsEditInspector";

type ConflictInspectorPanelProps = {
	item: MiniCutReviewItem | null;
	onClose?: () => void;
	onAcknowledgeReviewItem?: (item: MiniCutReviewItem) => void;
	onReviewAction?: (
		actionId: string,
		item: MiniCutReviewItem,
		payload?: unknown,
	) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const previewLabel = (preview: unknown): string => {
	if (!preview || typeof preview !== "object") {
		return "No preview available";
	}
	const type = (preview as { type?: unknown }).type;
	return typeof type === "string" ? type.replaceAll("_", " ") : "Review preview";
};

const actionLabel = (actionId: string): string =>
	actionId === "resolveClipTimingConflict"
		? "Resolve conflict"
		: actionId.replace(/([a-z])([A-Z])/g, "$1 $2");

const ActionButtons = ({
	item,
	onReviewAction,
}: {
	item: MiniCutReviewItem;
	onReviewAction?: (
		actionId: string,
		item: MiniCutReviewItem,
		payload?: unknown,
	) => void;
}) => (
	<>
		{item.availableActions.flatMap((actionId) => {
			if (
				actionId === "resolveClipTimingConflict" ||
				actionId === "parkIncomingVariantOnReviewTrack" ||
				actionId === "resolveTrackOrderConflict" ||
				actionId === "preserveCurrentTrackOrder" ||
				actionId === "createManualTrackOrderSuggestion"
			) {
				return [];
			}
			return (
				<button
					key={actionId}
					type="button"
					onClick={() => onReviewAction?.(actionId, item)}
				>
					<Check aria-hidden="true" size={16} />
					{actionLabel(actionId)}
				</button>
			);
		})}
	</>
);

export const ConflictInspectorPanel = ({
	item,
	onClose,
	onAcknowledgeReviewItem,
	onReviewAction,
}: ConflictInspectorPanelProps) => {
	return (
		<section className="ve-review-inspector" aria-label="Conflict inspector">
			<header>
				<h2>Review inspector</h2>
				{onClose ? (
					<button
						type="button"
						title="Close"
						aria-label="Close"
						onClick={onClose}
					>
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
					{item.kind === "clip_timing" ? (
						<ClipTimingConflictInspector
							item={item}
							onResolve={(payload) =>
								onReviewAction?.(
									"resolveClipTimingConflict",
									item,
									payload,
								)
							}
							onParkVariant={(payload) =>
								onReviewAction?.(
									"parkIncomingVariantOnReviewTrack",
									item,
									payload,
								)
							}
						/>
					) : null}
					{item.kind === "track_order" ? (
						<TrackOrderInspector
							item={item}
							onApplyOrder={(payload) =>
								onReviewAction?.(
									"resolveTrackOrderConflict",
									item,
									payload,
								)
							}
							onPreserveCurrentOrder={(payload) =>
								onReviewAction?.(
									"preserveCurrentTrackOrder",
									item,
									payload,
								)
							}
							onCreateManualSuggestion={(payload) =>
								onReviewAction?.(
									"createManualTrackOrderSuggestion",
									item,
									payload,
								)
							}
						/>
					) : null}
					{item.kind === "delete_vs_edit" ? (
						<DeleteVsEditInspector
							item={item}
							onRestoreVariant={(payload) =>
								onReviewAction?.(
									"resolveDeleteVsEditByRestoreVariant",
									item,
									payload,
								)
							}
							onParkVariant={(payload) =>
								onReviewAction?.(
									"parkEditedVariantOnReviewTrack",
									item,
									payload,
								)
							}
							onPreserveDelete={(payload) =>
								onReviewAction?.(
									"preserveDeleteAndArchiveIncomingEdit",
									item,
									payload,
								)
							}
						/>
					) : null}
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
						<ActionButtons
							item={item}
							onReviewAction={onReviewAction}
						/>
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
};
