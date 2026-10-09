import { Check, CopyPlus } from "lucide-react";
import { useMemo, useState } from "react";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import {
	clipTimingFields,
	type ClipTimingField,
	type ClipTimingPreview,
	type ClipTimingVariant,
} from "../../../dkt/review/features/clipTiming";
import {
	formatClipTimingValue,
	readClipTimingResolutionSummary,
	visibleClipTimingFields,
} from "../../../dkt/review/features/clipTiming/clipTimingResolution";
import {
	buildClipTimingParkPayload,
	buildClipTimingResolvePayload,
} from "../reviewActionPayloads";

type Props = {
	item: MiniCutReviewItem;
	onResolve: (payload: unknown) => void;
	onParkVariant: (payload: unknown) => void;
};

const fields = clipTimingFields;

const isClipTimingPreview = (value: unknown): value is ClipTimingPreview =>
	Boolean(value) &&
	typeof value === "object" &&
	(value as { type?: unknown }).type === "clip_timing" &&
	typeof (value as { current?: Record<string, unknown> }).current?.start ===
		"number" &&
	typeof (value as { incoming?: Record<string, unknown> }).incoming?.start ===
		"number";

const ClipTimingResolvedSummary = ({ item }: { item: MiniCutReviewItem }) => {
	const { variant, appliedTiming, parkedClipId } =
		readClipTimingResolutionSummary(item);

	return (
		<div className="ve-review-inspector__resolution">
			<strong>Resolution result</strong>
			{variant ? <p>{variant.replaceAll("_", " ")} applied</p> : null}
			{appliedTiming ? (
				<table className="ve-review-inspector__timing">
					<caption>Applied timing</caption>
					<tbody>
						{fields.map((field) => (
							<tr key={field}>
								<th scope="row">{field}</th>
								<td>{formatClipTimingValue(appliedTiming[field])}</td>
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
		() => visibleClipTimingFields(preview),
		[preview],
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
							<td>{formatClipTimingValue(preview.current[field])}</td>
							<td>{formatClipTimingValue(preview.incoming[field])}</td>
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
