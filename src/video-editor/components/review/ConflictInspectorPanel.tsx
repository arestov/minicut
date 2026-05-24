import { Check, Info, X } from "lucide-react";
import type { MiniCutReviewItem } from "../../dkt/review/types";

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

const timingFields = ["start", "in", "duration", "fadeIn", "fadeOut"] as const;

type TimingField = (typeof timingFields)[number];
type TimingDecision = Partial<Record<TimingField, number>>;
type ClipTimingAlternatives = {
	local: TimingDecision | null;
	incoming: TimingDecision | null;
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

const toTimingDecision = (value: unknown): TimingDecision | null => {
	if (!isRecord(value)) {
		return null;
	}
	const result: TimingDecision = {};
	for (const field of timingFields) {
		const fieldValue = value[field];
		if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) {
			result[field] = fieldValue;
		}
	}
	return Object.keys(result).length > 0 ? result : null;
};

const clipTimingAlternatives = (
	preview: unknown,
): ClipTimingAlternatives | null => {
	if (!isRecord(preview) || preview.type !== "clip_timing") {
		return null;
	}
	const payload = isRecord(preview.payload) ? preview.payload : null;
	const variants = isRecord(preview.variants) ? preview.variants : null;
	const local =
		toTimingDecision(payload?.current) ??
		toTimingDecision(payload?.local) ??
		toTimingDecision(variants?.current) ??
		toTimingDecision(variants?.local);
	const incoming =
		toTimingDecision(payload?.incoming) ?? toTimingDecision(variants?.incoming);
	if (!local && !incoming) {
		return null;
	}
	return { local, incoming };
};

const formatTimingValue = (value: number | undefined): string =>
	typeof value === "number" ? `${Number(value.toFixed(3))}s` : "-";

const actionLabel = (actionId: string): string =>
	actionId === "resolveClipTimingConflict"
		? "Resolve conflict"
		: actionId.replace(/([a-z])([A-Z])/g, "$1 $2");

const ClipTimingPreview = ({
	alternatives,
}: {
	alternatives: ClipTimingAlternatives | null;
}) => {
	if (!alternatives) {
		return null;
	}
	const rows = timingFields.filter(
		(field) =>
			alternatives.local?.[field] !== undefined ||
			alternatives.incoming?.[field] !== undefined,
	);
	if (rows.length === 0) {
		return null;
	}
	return (
		<table className="ve-review-inspector__timing">
			<caption>Timing alternatives</caption>
			<thead>
				<tr>
					<th scope="col">Field</th>
					<th scope="col">Local</th>
					<th scope="col">Incoming</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((field) => (
					<tr key={field}>
						<th scope="row">{field}</th>
						<td>{formatTimingValue(alternatives.local?.[field])}</td>
						<td>{formatTimingValue(alternatives.incoming?.[field])}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
};

const ActionButtons = ({
	item,
	alternatives,
	onReviewAction,
}: {
	item: MiniCutReviewItem;
	alternatives: ClipTimingAlternatives | null;
	onReviewAction?: (
		actionId: string,
		item: MiniCutReviewItem,
		payload?: unknown,
	) => void;
}) => (
	<>
		{item.availableActions.flatMap((actionId) => {
			if (actionId === "resolveClipTimingConflict" && alternatives) {
				return [
					<button
						key={`${actionId}:local`}
						type="button"
						disabled={!alternatives.local}
						onClick={() =>
							onReviewAction?.(actionId, item, alternatives.local ?? undefined)
						}
					>
						<Check aria-hidden="true" size={16} />
						Use local changes
					</button>,
					<button
						key={`${actionId}:incoming`}
						type="button"
						disabled={!alternatives.incoming}
						onClick={() =>
							onReviewAction?.(
								actionId,
								item,
								alternatives.incoming ?? undefined,
							)
						}
					>
						<Check aria-hidden="true" size={16} />
						Use incoming changes
					</button>,
				];
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
	const alternatives = clipTimingAlternatives(item?.preview);
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
					<ClipTimingPreview alternatives={alternatives} />
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
							alternatives={alternatives}
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
