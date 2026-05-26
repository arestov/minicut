import { Check, FileVideo, Link, WifiOff } from "lucide-react";
import { useState } from "react";
import type { DanglingResourcePreview } from "../../../dkt/review/features/danglingResource";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import {
	buildDanglingOfflinePayload,
	buildDanglingRelinkPayload,
} from "../reviewActionPayloads";

type Props = {
	item: MiniCutReviewItem;
	onRelink: (payload: unknown) => void;
	onKeepPlaceholder: (payload: unknown) => void;
};

const isDanglingResourcePreview = (
	value: unknown,
): value is DanglingResourcePreview =>
	Boolean(value) &&
	typeof value === "object" &&
	(value as { type?: unknown }).type === "dangling_resource" &&
	typeof (value as { resourceId?: unknown }).resourceId === "string";

export const DanglingResourceInspector = ({
	item,
	onRelink,
	onKeepPlaceholder,
}: Props) => {
	if (!isDanglingResourcePreview(item.preview)) {
		throw new Error("DanglingResourceInspector requires dangling resource preview");
	}
	const preview = item.preview;
	const [replacementUrl, setReplacementUrl] = useState("");
	const [sourceKind, setSourceKind] = useState("file");
	const canRelink = replacementUrl.trim().length > 0 && sourceKind.length > 0;

	return (
		<div className="ve-review-inspector__dangling-resource">
			<div className="ve-review-inspector__summary">
				<FileVideo aria-hidden="true" size={16} />
				<div>
					<strong>{preview.resourceName}</strong>
					<span>
						{preview.resourceKind} / missing
						{preview.missingUrl ? ` / ${preview.missingUrl}` : ""}
					</span>
				</div>
			</div>
			{preview.clipIds.length > 0 ? (
				<ul aria-label="Affected clips">
					{preview.clipIds.map((clipId) => (
						<li key={clipId}>{clipId}</li>
					))}
				</ul>
			) : null}
			<div className="ve-review-inspector__field">
				<label htmlFor="dangling-resource-url">Replacement source</label>
				<input
					id="dangling-resource-url"
					type="url"
					value={replacementUrl}
					onChange={(event) => setReplacementUrl(event.target.value)}
					placeholder="https://media.example/source.mov"
				/>
			</div>
			<div className="ve-review-inspector__field">
				<label htmlFor="dangling-resource-source-kind">Source kind</label>
				<select
					id="dangling-resource-source-kind"
					value={sourceKind}
					onChange={(event) => setSourceKind(event.target.value)}
				>
					<option value="file">File</option>
					<option value="url">URL</option>
					<option value="remote">Remote</option>
				</select>
			</div>
			<div className="ve-review-inspector__actions">
				<button
					type="button"
					disabled={!canRelink}
					onClick={() =>
						onRelink(
							buildDanglingRelinkPayload(item, {
								replacementUrl,
								sourceKind,
							}),
						)
					}
				>
					<Link aria-hidden="true" size={16} />
					Relink media
				</button>
				<button
					type="button"
					onClick={() => onKeepPlaceholder(buildDanglingOfflinePayload(item))}
				>
					<WifiOff aria-hidden="true" size={16} />
					Keep offline placeholder
				</button>
				{canRelink ? <Check aria-hidden="true" size={16} /> : null}
			</div>
		</div>
	);
};
