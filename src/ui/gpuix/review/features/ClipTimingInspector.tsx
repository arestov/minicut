import { For, Show, createSignal } from "solid-js";
import {
	buildClipTimingParkPayload,
	buildClipTimingResolvePayload,
} from "../../../../video-editor/components/review/reviewActionPayloads";
import type {
	ClipTimingField,
	ClipTimingPreview,
	ClipTimingVariant,
} from "../../../../video-editor/dkt/review/features/clipTiming";
import {
	formatClipTimingValue,
	readClipTimingResolutionSummary,
	visibleClipTimingFields,
} from "../../../../video-editor/dkt/review/features/clipTiming/clipTimingResolution";
import type { MiniCutReviewItem } from "../../../../video-editor/dkt/review/types";
import { clipTimingFields } from "../../../../video-editor/dkt/review/features/clipTiming";
import { NumberField } from "../../controls/NumberField";
import { SectionTitle } from "../../controls/Field";
import { colors } from "../../theme";
import type { ReviewActions } from "../useReviewActions";
import { readPreview } from "../readPreview";
import { ActionButton, ActionRow, Group, MutedText } from "../ReviewParts";

const FIELD_WIDTH = 84;
const VALUE_WIDTH = 72;

const cell = (testId: string | undefined, text: string, muted = false) => (
	<text
		testId={testId}
		style={{
			width: VALUE_WIDTH,
			flexShrink: 0,
			fontSize: 12,
			color: muted ? colors.textMuted : colors.text,
		}}
	>
		{text}
	</text>
);

const ResolvedSummary = (props: { item: MiniCutReviewItem }) => {
	const summary = () => readClipTimingResolutionSummary(props.item);
	return (
		<Group>
			<SectionTitle>Resolution result</SectionTitle>
			<Show when={summary().variant}>
				{(variant) => (
					<text testId="timing-variant" style={{ fontSize: 12 }}>
						{`${variant().replaceAll("_", " ")} applied`}
					</text>
				)}
			</Show>
			<Show
				when={summary().appliedTiming}
				fallback={<MutedText testId="timing-unavailable">Resolution details unavailable</MutedText>}
			>
				{(timing) => (
					<>
						<MutedText>Applied timing</MutedText>
						<For each={clipTimingFields}>
							{(field) => (
								<div style={{ display: "flex", gap: 6 }}>
									<text style={{ width: FIELD_WIDTH, fontSize: 12, color: colors.textMuted }}>
										{field}
									</text>
									{cell(`timing-applied-${field}`, formatClipTimingValue(timing()[field]))}
								</div>
							)}
						</For>
					</>
				)}
			</Show>
			<Show when={summary().parkedClipId}>
				{(clipId) => <text style={{ fontSize: 12 }}>{`Parked variant: ${clipId()}`}</text>}
			</Show>
		</Group>
	);
};

const Open = (props: {
	item: MiniCutReviewItem;
	preview: ClipTimingPreview;
	actions: ReviewActions;
}) => {
	const [draft, setDraft] = createSignal<ClipTimingVariant>(props.preview.current);
	const setField = (field: ClipTimingField, value: number) =>
		setDraft((current) => ({ ...current, [field]: value }));
	const resolve = (choice: "current" | "incoming" | "custom") =>
		props.actions.act(
			props.item,
			"resolveClipTimingConflict",
			buildClipTimingResolvePayload(
				props.item,
				choice,
				choice === "custom" ? draft() : undefined,
			),
		);

	return (
		<Group>
			<SectionTitle>Timing variants</SectionTitle>
			<div style={{ display: "flex", gap: 6 }}>
				<text style={{ width: FIELD_WIDTH, fontSize: 12, color: colors.textMuted }}>Field</text>
				{cell(undefined, "Current", true)}
				{cell(undefined, "Incoming", true)}
				<text style={{ fontSize: 12, color: colors.textMuted }}>Final</text>
			</div>
			<For each={visibleClipTimingFields(props.preview)}>
				{(field) => (
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<text style={{ width: FIELD_WIDTH, fontSize: 12 }}>{field}</text>
						{cell(
							`timing-current-${field}`,
							formatClipTimingValue(props.preview.current[field]),
						)}
						{cell(
							`timing-incoming-${field}`,
							formatClipTimingValue(props.preview.incoming[field]),
						)}
						<NumberField
							testId={`timing-final-${field}`}
							width={80}
							value={draft()[field]}
							onChange={(value) => setField(field, value)}
						/>
					</div>
				)}
			</For>
			<ActionRow>
				<ActionButton
					testId="timing-choose-current"
					label="Choose current"
					onClick={() => resolve("current")}
				/>
				<ActionButton
					testId="timing-choose-incoming"
					label="Choose incoming"
					onClick={() => resolve("incoming")}
				/>
				<ActionButton
					testId="timing-apply-final"
					label="Apply final timing"
					onClick={() => resolve("custom")}
				/>
				<ActionButton
					testId="timing-park-incoming"
					label="Park incoming on review track"
					onClick={() =>
						props.actions.act(
							props.item,
							"parkIncomingVariantOnReviewTrack",
							buildClipTimingParkPayload(props.item),
						)
					}
				/>
			</ActionRow>
		</Group>
	);
};

/**
 * Clip timing conflict: current and incoming timing side by side, an editable
 * final timing, and the resolve and park actions. A resolved item shows what
 * was applied.
 */
export const ClipTimingInspector = (props: {
	item: MiniCutReviewItem;
	actions: ReviewActions;
}) => {
	const preview = () =>
		readPreview<ClipTimingPreview>(props.item, "clip_timing", (value) => {
			const current = value.current as { start?: unknown } | undefined;
			const incoming = value.incoming as { start?: unknown } | undefined;
			return (
				typeof current?.start === "number" && typeof incoming?.start === "number"
			);
		});

	return (
		<Show
			when={props.item.status !== "resolved"}
			fallback={<ResolvedSummary item={props.item} />}
		>
			<Show when={preview()} fallback={<MutedText>Clip timing preview unavailable</MutedText>}>
				{(current) => (
					<Open item={props.item} preview={current()} actions={props.actions} />
				)}
			</Show>
		</Show>
	);
};
