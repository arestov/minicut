import { Check, CopyPlus } from "lucide-react";
import { useMemo, useState } from "react";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import type {
	ClipTimingField,
	ClipTimingPreview,
	ClipTimingVariant,
} from "../../../dkt/review/features/clipTiming";
import {
	buildClipTimingParkPayload,
	buildClipTimingResolvePayload,
} from "../reviewActionPayloads";

type Props = {
	item: MiniCutReviewItem;
	onResolve: (payload: unknown) => void;
	onParkVariant: (payload: unknown) => void;
};

const fields: ClipTimingField[] = [
	"start",
	"in",
	"duration",
	"fadeIn",
	"fadeOut",
];

const isClipTimingPreview = (value: unknown): value is ClipTimingPreview =>
	Boolean(value) &&
	typeof value === "object" &&
	(value as { type?: unknown }).type === "clip_timing" &&
	typeof (value as { current?: Record<string, unknown> }).current?.start ===
		"number" &&
	typeof (value as { incoming?: Record<string, unknown> }).incoming?.start ===
		"number";

const formatTimingValue = (value: number): string => `${Number(value.toFixed(3))}s`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const resolutionDomainResult = (item: MiniCutReviewItem): Record<string, unknown> | null => {
	const resolution = isRecord(item.resolution) ? item.resolution : null;
	const domainResult = resolution?.domain_result;
	return isRecord(domainResult) ? domainResult : null;
};

const timingFromRecord = (value: unknown): ClipTimingVariant | null => {
	if (!isRecord(value)) {
		return null;
	}
	const result = Object.fromEntries(
		fields.map((field) => [field, value[field]]),
	) as Record<ClipTimingField, unknown>;
	return fields.every(
		(field) => typeof result[field] === "number" && Number.isFinite(result[field]),
	)
		? (result as ClipTimingVariant)
		: null;
};

const ClipTimingResolvedSummary = ({ item }: { item: MiniCutReviewItem }) => {
	const result = resolutionDomainResult(item);
	const sourceTiming =
		timingFromRecord(result?.sourceTiming) ??
		timingFromRecord(result) ??
		null;
	const parkedClipId = isRecord(result?.parkedClipId)
		? "parked clip"
		: typeof result?.parkedClipId === "string"
			? result.parkedClipId
			: null;
	const variant =
		typeof result?.variant === "string"
			? result.variant
			: typeof result?.selectedVariant === "string"
				? result.selectedVariant
				: null;

	return (
		<div className="ve-review-inspector__resolution">
			<strong>Resolution result</strong>
			{variant ? <p>{variant.replaceAll("_", " ")} applied</p> : null}
			{sourceTiming ? (
				<table className="ve-review-inspector__timing">
					<caption>Applied timing</caption>
					<tbody>
						{fields.map((field) => (
							<tr key={field}>
								<th scope="row">{field}</th>
								<td>{formatTimingValue(sourceTiming[field])}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : (
				<p>Resolution details unavailable</p>
			)}
			{parkedClipId ? <p>Parked variant: {parkedClipId}</p> : null}
		</div>
	);
};

export const ClipTimingConflictInspector = ({
	item,
	onResolve,
	onParkVariant,
}: Props) => {
	if (!isClipTimingPreview(item.preview)) {
		throw new Error("ClipTimingConflictInspector requires clip timing preview");
	}
	const preview = item.preview;
	const [draft, setDraft] = useState<ClipTimingVariant>(preview.current);
	const visibleFields = useMemo(
		() =>
			fields.filter(
				(field) =>
					preview.fields.includes(field) ||
					field === "fadeIn" ||
					field === "fadeOut",
			),
		[preview.fields],
	);
	const setField = (field: ClipTimingField, value: string) => {
		const next = Number(value);
		setDraft((current) => ({
			...current,
			[field]: Number.isFinite(next) ? next : current[field],
		}));
	};

	if (item.status === "resolved") {
		return <ClipTimingResolvedSummary item={item} />;
	}

	return (
		<div className="ve-review-inspector__clip-timing">
			<table className="ve-review-inspector__timing">
				<caption>Timing variants</caption>
				<thead>
					<tr>
						<th scope="col">Field</th>
						<th scope="col">Current</th>
						<th scope="col">Incoming</th>
						<th scope="col">Final</th>
					</tr>
				</thead>
				<tbody>
					{visibleFields.map((field) => (
						<tr key={field}>
							<th scope="row">{field}</th>
							<td>{formatTimingValue(preview.current[field])}</td>
							<td>{formatTimingValue(preview.incoming[field])}</td>
							<td>
								<input
									aria-label={`Final ${field}`}
									type="number"
									step="0.1"
									min="0"
									value={draft[field]}
									onChange={(event) => setField(field, event.target.value)}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<div className="ve-review-inspector__actions">
				<button
					type="button"
					onClick={() =>
						onResolve(buildClipTimingResolvePayload(item, "current"))
					}
				>
					<Check aria-hidden="true" size={16} />
					Choose current
				</button>
				<button
					type="button"
					onClick={() =>
						onResolve(buildClipTimingResolvePayload(item, "incoming"))
					}
				>
					<Check aria-hidden="true" size={16} />
					Choose incoming
				</button>
				<button
					type="button"
					onClick={() =>
						onResolve(buildClipTimingResolvePayload(item, "custom", draft))
					}
				>
					<Check aria-hidden="true" size={16} />
					Apply final timing
				</button>
				<button
					type="button"
					onClick={() => onParkVariant(buildClipTimingParkPayload(item))}
				>
					<CopyPlus aria-hidden="true" size={16} />
					Park incoming on review track
				</button>
			</div>
		</div>
	);
};
