import { For, Show, createSignal } from "solid-js";
import {
	buildDanglingOfflinePayload,
	buildDanglingRelinkPayload,
} from "../../../../video-editor/components/review/reviewActionPayloads";
import type { DanglingResourcePreview } from "../../../../video-editor/dkt/review/features/danglingResource";
import type { MiniCutReviewItem } from "../../../../video-editor/dkt/review/types";
import { Segmented } from "../../controls/Segmented";
import { Field, SectionTitle } from "../../controls/Field";
import { TextField } from "../../controls/TextField";
import { colors } from "../../theme";
import { readPreview } from "../readPreview";
import type { ReviewActions } from "../useReviewActions";
import { ActionButton, ActionRow, Group, MutedText } from "../ReviewParts";

const SOURCE_KINDS = [
	{ value: "file", label: "File" },
	{ value: "url", label: "URL" },
	{ value: "remote", label: "Remote" },
] as const;
type SourceKind = (typeof SOURCE_KINDS)[number]["value"];

/** A resource removed while a clip still uses it: relink it or keep it offline. */
export const DanglingResourceInspector = (props: {
	item: MiniCutReviewItem;
	actions: ReviewActions;
}) => {
	const preview = () =>
		readPreview<DanglingResourcePreview>(
			props.item,
			"dangling_resource",
			(value) => typeof value.resourceId === "string",
		);
	const [replacementUrl, setReplacementUrl] = createSignal("");
	const [sourceKind, setSourceKind] = createSignal<SourceKind>("file");
	const canRelink = () => replacementUrl().trim().length > 0;

	return (
		<Show when={preview()} fallback={<MutedText>Dangling resource preview unavailable</MutedText>}>
			{(current) => (
				<>
					<Group>
						<text testId="dangling-name" style={{ fontSize: 12, fontWeight: 600 }}>
							{current().resourceName}
						</text>
						<text testId="dangling-detail" style={{ fontSize: 12, color: colors.textMuted }}>
							{`${current().resourceKind} / missing${
								current().missingUrl ? ` / ${current().missingUrl}` : ""
							}`}
						</text>
					</Group>
					<Show when={current().clipIds.length > 0}>
						<Group>
							<SectionTitle>Affected clips</SectionTitle>
							<For each={current().clipIds}>
								{(clipId) => (
									<text testId="dangling-clip" style={{ fontSize: 12 }}>
										{clipId}
									</text>
								)}
							</For>
						</Group>
					</Show>
					<Show when={props.item.status !== "resolved"}>
						<Field label="Replacement source" labelWidth={130}>
							<TextField
								testId="dangling-url"
								value={replacementUrl()}
								onInput={setReplacementUrl}
								placeholder="https://media.example/source.mov"
							/>
						</Field>
						<Field label="Source kind" labelWidth={130}>
							<Segmented
								testId="dangling-kind"
								options={SOURCE_KINDS}
								value={sourceKind()}
								onChange={setSourceKind}
							/>
						</Field>
						<ActionRow>
							<ActionButton
								testId="dangling-relink"
								label="Relink media"
								disabled={!canRelink()}
								onClick={() =>
									props.actions.act(
										props.item,
										"resolveDanglingResourceByRelink",
										buildDanglingRelinkPayload(props.item, {
											replacementUrl: replacementUrl(),
											sourceKind: sourceKind(),
										}),
									)
								}
							/>
							<ActionButton
								testId="dangling-offline"
								label="Keep offline placeholder"
								onClick={() =>
									props.actions.act(
										props.item,
										"keepOfflinePlaceholder",
										buildDanglingOfflinePayload(props.item),
									)
								}
							/>
						</ActionRow>
					</Show>
				</>
			)}
		</Show>
	);
};
