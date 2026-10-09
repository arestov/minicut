import { For } from "solid-js";
import { Many, useAttrs } from "../../../dkt-solid-sync";
import type { MiniCutReviewObject } from "../../../video-editor/dkt/review/types";
import { SectionTitle } from "../controls/Field";
import { colors } from "../theme";
import { MutedText } from "./ReviewParts";

const asArray = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value as Value[]) : [];

const ActivityRow = () => {
	const attrs = useAttrs([
		"batchId",
		"title",
		"created",
		"updated",
		"deleted",
		"openedConflictIds",
		"updatedConflictIds",
	]);
	const updated = () => asArray<MiniCutReviewObject>(attrs.updated());
	const rejected = () => updated().filter((object) => object.status === "rejected").length;
	const conflictIds = () => [
		...asArray<string>(attrs.openedConflictIds()),
		...asArray<string>(attrs.updatedConflictIds()),
	];

	return (
		<div testId="activity-row" style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
			<text style={{ fontSize: 11, color: colors.textMuted }}>
				{`Batch ${String(attrs.batchId() ?? "")}`}
			</text>
			<text style={{ fontSize: 12, fontWeight: 600 }}>
				{String(attrs.title() ?? "Project changes")}
			</text>
			<text testId="activity-counts" style={{ fontSize: 12 }}>
				{`${asArray(attrs.created()).length} created · ${updated().length} updated · ${
					asArray(attrs.deleted()).length
				} deleted${rejected() > 0 ? ` · ${rejected()} rejected` : ""}`}
			</text>
			<For each={conflictIds()}>
				{(conflictId) => (
					<text testId="activity-conflict" style={{ fontSize: 11, color: colors.accent }}>
						{conflictId}
					</text>
				)}
			</For>
		</div>
	);
};

const NoActivity = () => <MutedText testId="activity-empty">No sync activity</MutedText>;

/**
 * Sync activity of the active project: its activity summaries
 * (what a sync batch created, updated and deleted, and the conflicts it
 * opened), which the project model collects. Rendered inside the project scope.
 */
export const ActivitySummaryList = () => (
	<div
		testId="review-activity"
		style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, overflowY: "scroll" }}
	>
		<SectionTitle>Activity</SectionTitle>
		<Many rel="activitySummaries" item={ActivityRow} readyAttr="batchId" empty={<NoActivity />} />
	</div>
);
