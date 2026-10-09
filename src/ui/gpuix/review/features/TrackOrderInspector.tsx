import { For, Show, createMemo, createSignal } from "solid-js";
import {
	buildTrackOrderPayload,
	trackOrderIds,
} from "../../../../video-editor/components/review/reviewActionPayloads";
import type {
	TrackOrderEntry,
	TrackOrderPreview,
} from "../../../../video-editor/dkt/review/features/trackOrder";
import type { MiniCutReviewItem } from "../../../../video-editor/dkt/review/types";
import { Button } from "../../controls/Button";
import { SectionTitle } from "../../controls/Field";
import { colors } from "../../theme";
import { readPreview } from "../readPreview";
import type { ReviewActions } from "../useReviewActions";
import { ActionButton, ActionRow, Group, MutedText } from "../ReviewParts";

const OrderList = (props: {
	title: string;
	testId: string;
	order: TrackOrderEntry[];
	movedTrackIds: string[];
}) => (
	<Group grow>
		<SectionTitle>{props.title}</SectionTitle>
		<For each={props.order}>
			{(track, index) => (
				<div
					testId={`${props.testId}-row`}
					style={{ display: "flex", gap: 6, alignItems: "center" }}
				>
					<text style={{ fontSize: 12, color: colors.textMuted, width: 18 }}>
						{`${index() + 1}.`}
					</text>
					<text
						style={{
							fontSize: 12,
							color: props.movedTrackIds.includes(track.trackId)
								? colors.accent
								: colors.text,
						}}
					>
						{track.name}
					</text>
					<text style={{ fontSize: 11, color: colors.textMuted }}>{track.kind}</text>
				</div>
			)}
		</For>
	</Group>
);

const Open = (props: {
	item: MiniCutReviewItem;
	preview: TrackOrderPreview;
	actions: ReviewActions;
}) => {
	const [manualIds, setManualIds] = createSignal(
		trackOrderIds(props.preview.manualOrder ?? props.preview.currentOrder),
	);
	const entryById = createMemo(
		() =>
			new Map(
				[...props.preview.currentOrder, ...props.preview.incomingOrder].map(
					(entry) => [entry.trackId, entry],
				),
			),
	);
	const manualOrder = () =>
		manualIds().flatMap((trackId) => {
			const entry = entryById().get(trackId);
			return entry ? [entry] : [];
		});
	const move = (trackId: string, direction: -1 | 1) =>
		setManualIds((current) => {
			const index = current.indexOf(trackId);
			const nextIndex = index + direction;
			if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
				return current;
			}
			const next = [...current];
			const [entry] = next.splice(index, 1);
			next.splice(nextIndex, 0, entry);
			return next;
		});
	const movedNames = () =>
		props.preview.movedTrackIds
			.map((trackId) => entryById().get(trackId)?.name ?? trackId)
			.join(", ");

	return (
		<>
			<div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
				<OrderList
					title="Current order"
					testId="track-order-current"
					order={props.preview.currentOrder}
					movedTrackIds={props.preview.movedTrackIds}
				/>
				<OrderList
					title="Incoming order"
					testId="track-order-incoming"
					order={props.preview.incomingOrder}
					movedTrackIds={props.preview.movedTrackIds}
				/>
			</div>
			<Group>
				<SectionTitle>Manual order</SectionTitle>
				<For each={manualOrder()}>
					{(track, index) => (
						<div
							testId="track-order-manual-row"
							style={{ display: "flex", gap: 6, alignItems: "center" }}
						>
							<text style={{ fontSize: 12, width: 120 }}>{track.name}</text>
							<text style={{ fontSize: 11, color: colors.textMuted, width: 48 }}>
								{track.kind}
							</text>
							<Button
								testId={`track-order-up-${track.trackId}`}
								aria-label={`Move ${track.name} up`}
								disabled={index() === 0}
								onClick={() => move(track.trackId, -1)}
							>
								<text>Up</text>
							</Button>
							<Button
								testId={`track-order-down-${track.trackId}`}
								aria-label={`Move ${track.name} down`}
								disabled={index() === manualOrder().length - 1}
								onClick={() => move(track.trackId, 1)}
							>
								<text>Down</text>
							</Button>
						</div>
					)}
				</For>
			</Group>
			<Show when={props.preview.movedTrackIds.length > 0}>
				<text testId="track-order-moved" style={{ fontSize: 12 }}>
					{`Moved tracks: ${movedNames()}`}
				</text>
			</Show>
			<ActionRow>
				<ActionButton
					testId="track-order-keep-current"
					label="Keep current order"
					onClick={() =>
						props.actions.act(
							props.item,
							"preserveCurrentTrackOrder",
							buildTrackOrderPayload(props.item, "current"),
						)
					}
				/>
				<ActionButton
					testId="track-order-apply-incoming"
					label="Apply incoming order"
					onClick={() =>
						props.actions.act(
							props.item,
							"resolveTrackOrderConflict",
							buildTrackOrderPayload(props.item, "incoming"),
						)
					}
				/>
				<ActionButton
					testId="track-order-save-manual"
					label="Save manual suggestion"
					onClick={() =>
						props.actions.act(
							props.item,
							"createManualTrackOrderSuggestion",
							buildTrackOrderPayload(props.item, "manual", manualIds()),
						)
					}
				/>
				<ActionButton
					testId="track-order-apply-manual"
					label="Apply manual order"
					onClick={() =>
						props.actions.act(
							props.item,
							"resolveTrackOrderConflict",
							buildTrackOrderPayload(props.item, "manual", manualIds()),
						)
					}
				/>
			</ActionRow>
		</>
	);
};

/** Track order conflict: both orders, an editable manual order and the choices. */
export const TrackOrderInspector = (props: {
	item: MiniCutReviewItem;
	actions: ReviewActions;
}) => {
	const preview = () =>
		readPreview<TrackOrderPreview>(
			props.item,
			"track_order",
			(value) =>
				Array.isArray(value.currentOrder) && Array.isArray(value.incomingOrder),
		);
	return (
		<Show when={preview()} fallback={<MutedText>Track order preview unavailable</MutedText>}>
			{(current) => (
				<Show
					when={props.item.status !== "resolved"}
					fallback={
						<>
							<OrderList
								title="Current order"
								testId="track-order-current"
								order={current().currentOrder}
								movedTrackIds={current().movedTrackIds}
							/>
							<OrderList
								title="Incoming order"
								testId="track-order-incoming"
								order={current().incomingOrder}
								movedTrackIds={current().movedTrackIds}
							/>
						</>
					}
				>
					<Open item={props.item} preview={current()} actions={props.actions} />
				</Show>
			)}
		</Show>
	);
};
