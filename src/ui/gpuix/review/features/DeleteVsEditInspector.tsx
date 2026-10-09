import { Show } from "solid-js";
import {
	buildDeleteVsEditArchivePayload,
	buildDeleteVsEditParkPayload,
	buildDeleteVsEditRestorePayload,
} from "../../../../video-editor/components/review/reviewActionPayloads";
import type { DeleteVsEditPreview } from "../../../../video-editor/dkt/review/features/deleteVsEdit";
import type { MiniCutReviewItem } from "../../../../video-editor/dkt/review/types";
import { Field, SectionTitle } from "../../controls/Field";
import { readPreview } from "../readPreview";
import type { ReviewActions } from "../useReviewActions";
import { ActionButton, ActionRow, Group, MutedText } from "../ReviewParts";

const textValue = (value: unknown, fallback = "Unknown"): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const secondsValue = (value: unknown): string =>
	typeof value === "number" && Number.isFinite(value)
		? `${Number(value.toFixed(3))}s`
		: "Unset";

const Value = (props: { testId: string; children: string }) => (
	<text testId={props.testId} style={{ fontSize: 12 }}>
		{props.children}
	</text>
);

/** Delete versus edit: what each side did, and how to keep, restore or archive. */
export const DeleteVsEditInspector = (props: {
	item: MiniCutReviewItem;
	actions: ReviewActions;
}) => {
	const preview = () => readPreview<DeleteVsEditPreview>(props.item, "delete_vs_edit");
	return (
		<Show when={preview()} fallback={<MutedText>Delete-vs-edit preview unavailable</MutedText>}>
			{(current) => {
				const clipAttrs = () => current().editedVariant.clipAttrs;
				const resourceAttrs = () => current().editedVariant.resourceAttrs;
				const act = (actionId: string, payload: unknown) =>
					props.actions.act(props.item, actionId, payload);
				return (
					<>
						<div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
							<Group grow>
								<SectionTitle>Deleted side</SectionTitle>
								<Field label="Clip" labelWidth={96}>
									<Value testId="dve-deleted-clip">
										{textValue(current().deletedVariant.clipId)}
									</Value>
								</Field>
								<Field label="Resource" labelWidth={96}>
									<Value testId="dve-deleted-resource">
										{textValue(current().deletedVariant.resourceId)}
									</Value>
								</Field>
								<Field label="Peer" labelWidth={96}>
									<Value testId="dve-deleted-peer">
										{textValue(current().deletedVariant.peerId)}
									</Value>
								</Field>
							</Group>
							<Group grow>
								<SectionTitle>Edited side</SectionTitle>
								<Field label="Clip name" labelWidth={96}>
									<Value testId="dve-edited-clip">
										{textValue(clipAttrs().name, "Edited clip")}
									</Value>
								</Field>
								<Field label="Resource name" labelWidth={96}>
									<Value testId="dve-edited-resource">
										{textValue(resourceAttrs()?.name, "Referenced resource")}
									</Value>
								</Field>
								<Field label="Start" labelWidth={96}>
									<Value testId="dve-edited-start">{secondsValue(clipAttrs().start)}</Value>
								</Field>
								<Field label="Duration" labelWidth={96}>
									<Value testId="dve-edited-duration">
										{secondsValue(clipAttrs().duration)}
									</Value>
								</Field>
							</Group>
						</div>
						<Show when={props.item.status !== "resolved"}>
							<ActionRow>
								<ActionButton
									testId="dve-restore"
									label="Restore edited variant"
									onClick={() =>
										act(
											"resolveDeleteVsEditByRestoreVariant",
											buildDeleteVsEditRestorePayload(props.item),
										)
									}
								/>
								<ActionButton
									testId="dve-park"
									label="Park edited on review track"
									onClick={() =>
										act(
											"parkEditedVariantOnReviewTrack",
											buildDeleteVsEditParkPayload(props.item),
										)
									}
								/>
								<ActionButton
									testId="dve-archive"
									label="Preserve delete and archive edit"
									onClick={() =>
										act(
											"preserveDeleteAndArchiveIncomingEdit",
											buildDeleteVsEditArchivePayload(props.item),
										)
									}
								/>
							</ActionRow>
						</Show>
					</>
				);
			}}
		</Show>
	);
};
