import { Archive, CopyPlus, RotateCcw } from "lucide-react";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import type { DeleteVsEditPreview } from "../../../dkt/review/features/deleteVsEdit";
import {
	buildDeleteVsEditArchivePayload,
	buildDeleteVsEditParkPayload,
	buildDeleteVsEditRestorePayload,
} from "../reviewActionPayloads";

type Props = {
	item: MiniCutReviewItem;
	onRestoreVariant: (payload: unknown) => void;
	onParkVariant: (payload: unknown) => void;
	onPreserveDelete: (payload: unknown) => void;
};

const isPreview = (value: unknown): value is DeleteVsEditPreview =>
	Boolean(value) &&
	typeof value === "object" &&
	(value as { type?: unknown }).type === "delete_vs_edit";

const textValue = (value: unknown, fallback = "Unknown"): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const numberValue = (value: unknown): string =>
	typeof value === "number" && Number.isFinite(value)
		? `${Number(value.toFixed(3))}s`
		: "Unset";

export const DeleteVsEditInspector = ({
	item,
	onRestoreVariant,
	onParkVariant,
	onPreserveDelete,
}: Props) => {
	if (!isPreview(item.preview)) {
		throw new Error("DeleteVsEditInspector requires delete-vs-edit preview");
	}
	const preview = item.preview;
	const clipAttrs = preview.editedVariant.clipAttrs;
	const resourceAttrs = preview.editedVariant.resourceAttrs;

	return (
		<div className="ve-review-inspector__delete-vs-edit">
			<div className="ve-review-inspector__variant-grid">
				<section aria-label="Deleted variant">
					<h3>Deleted side</h3>
					<dl>
						<div>
							<dt>Clip</dt>
							<dd>{textValue(preview.deletedVariant.clipId)}</dd>
						</div>
						<div>
							<dt>Resource</dt>
							<dd>{textValue(preview.deletedVariant.resourceId)}</dd>
						</div>
						<div>
							<dt>Peer</dt>
							<dd>{textValue(preview.deletedVariant.peerId)}</dd>
						</div>
					</dl>
				</section>
				<section aria-label="Edited variant">
					<h3>Edited side</h3>
					<dl>
						<div>
							<dt>Clip name</dt>
							<dd>{textValue(clipAttrs.name, "Edited clip")}</dd>
						</div>
						<div>
							<dt>Resource name</dt>
							<dd>{textValue(resourceAttrs?.name, "Referenced resource")}</dd>
						</div>
						<div>
							<dt>Start</dt>
							<dd>{numberValue(clipAttrs.start)}</dd>
						</div>
						<div>
							<dt>Duration</dt>
							<dd>{numberValue(clipAttrs.duration)}</dd>
						</div>
					</dl>
				</section>
			</div>
			<div className="ve-review-inspector__actions">
				<button
					type="button"
					onClick={() => onRestoreVariant(buildDeleteVsEditRestorePayload(item))}
				>
					<RotateCcw aria-hidden="true" size={16} />
					Restore edited variant
				</button>
				<button
					type="button"
					onClick={() => onParkVariant(buildDeleteVsEditParkPayload(item))}
				>
					<CopyPlus aria-hidden="true" size={16} />
					Park edited on review track
				</button>
				<button
					type="button"
					onClick={() => onPreserveDelete(buildDeleteVsEditArchivePayload(item))}
				>
					<Archive aria-hidden="true" size={16} />
					Preserve delete and archive edit
				</button>
			</div>
		</div>
	);
};
