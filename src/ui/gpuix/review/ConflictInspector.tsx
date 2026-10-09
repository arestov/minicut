import { For, Match, Show, Switch } from "solid-js";
import { useAttrs } from "../../../dkt-solid-sync";
import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";
import { Field, SectionTitle } from "../controls/Field";
import { colors } from "../theme";
import { ClipTimingInspector } from "./features/ClipTimingInspector";
import { DanglingResourceInspector } from "./features/DanglingResourceInspector";
import { DeleteVsEditInspector } from "./features/DeleteVsEditInspector";
import { TrackOrderInspector } from "./features/TrackOrderInspector";
import { ActionButton, ActionRow, Group, MutedText } from "./ReviewParts";
import { useReviewActions, type ReviewActions } from "./useReviewActions";

/** Actions each feature inspector owns; they are not offered as generic buttons. */
const FEATURE_ACTIONS = new Set([
	"resolveClipTimingConflict",
	"parkIncomingVariantOnReviewTrack",
	"resolveTrackOrderConflict",
	"preserveCurrentTrackOrder",
	"createManualTrackOrderSuggestion",
	"resolveDeleteVsEditByRestoreVariant",
	"parkEditedVariantOnReviewTrack",
	"preserveDeleteAndArchiveIncomingEdit",
	"resolveDanglingResourceByRelink",
	"keepOfflinePlaceholder",
]);

const previewLabel = (preview: unknown): string => {
	if (!preview || typeof preview !== "object") {
		return "No preview available";
	}
	const type = (preview as { type?: unknown }).type;
	return typeof type === "string" ? type.replaceAll("_", " ") : "Review preview";
};

const actionLabel = (actionId: string): string =>
	actionId.replace(/([a-z])([A-Z])/g, "$1 $2");

const Meta = (props: { label: string; testId: string; children: string }) => (
	<Field label={props.label} labelWidth={72}>
		<text testId={props.testId} style={{ fontSize: 12 }}>
			{props.children}
		</text>
	</Field>
);

const ItemBody = (props: { item: MiniCutReviewItem; actions: ReviewActions }) => (
	<>
		<Group>
			<text testId="review-title" style={{ fontSize: 13, fontWeight: 600 }}>
				{props.item.title}
			</text>
			<MutedText testId="review-preview-label">{previewLabel(props.item.preview)}</MutedText>
		</Group>
		<Group>
			<Meta label="Status" testId="review-status">
				{props.item.status}
			</Meta>
			<Meta label="Kind" testId="review-kind">
				{props.item.kind.replaceAll("_", " ")}
			</Meta>
			<Meta label="Conflict" testId="review-conflict-id">
				{props.item.conflictId}
			</Meta>
		</Group>
		<Switch>
			<Match when={props.item.kind === "clip_timing"}>
				<ClipTimingInspector item={props.item} actions={props.actions} />
			</Match>
			<Match when={props.item.kind === "track_order"}>
				<TrackOrderInspector item={props.item} actions={props.actions} />
			</Match>
			<Match when={props.item.kind === "delete_vs_edit"}>
				<DeleteVsEditInspector item={props.item} actions={props.actions} />
			</Match>
			<Match when={props.item.kind === "dangling_resource"}>
				<DanglingResourceInspector item={props.item} actions={props.actions} />
			</Match>
		</Switch>
		<Show when={props.item.affectedObjects.length > 0}>
			<Group>
				<SectionTitle>Affected objects</SectionTitle>
				<For each={props.item.affectedObjects}>
					{(object) => (
						<div testId="review-affected" style={{ display: "flex", gap: 6 }}>
							<text style={{ fontSize: 12 }}>{object.label ?? object.type}</text>
							<text style={{ fontSize: 11, color: colors.textMuted }}>{object.id}</text>
						</div>
					)}
				</For>
			</Group>
		</Show>
		<Show when={props.item.status === "open"}>
			<ActionRow>
				<For each={props.item.availableActions.filter((id) => !FEATURE_ACTIONS.has(id))}>
					{(actionId) => (
						<ActionButton
							testId={`review-action-${actionId}`}
							label={actionLabel(actionId)}
							onClick={() => props.actions.act(props.item, actionId)}
						/>
					)}
				</For>
				<ActionButton
					testId="review-acknowledge"
					label="Acknowledge"
					onClick={() => props.actions.acknowledge(props.item)}
				/>
			</ActionRow>
		</Show>
	</>
);

/**
 * Inspector of the review item in the surrounding scope: reads the item's
 * model snapshot and renders the inspector of its kind. A new inspector (and
 * its local drafts) is made when the shown item changes.
 */
export const ConflictInspector = () => {
	const attrs = useAttrs(["reviewItemSnapshot"]);
	const actions = useReviewActions();
	const item = () => attrs.reviewItemSnapshot() as MiniCutReviewItem | undefined;

	return (
		<Show when={item()?.id} keyed>
			{(_id) => <ItemBody item={item()!} actions={actions} />}
		</Show>
	);
};
