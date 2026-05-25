import { Check, GripVertical, Save } from "lucide-react";
import { useMemo, useState } from "react";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import type {
	TrackOrderEntry,
	TrackOrderPreview,
} from "../../../dkt/review/features/trackOrder";

type Props = {
	item: MiniCutReviewItem;
	onApplyOrder: (payload: unknown) => void;
	onPreserveCurrentOrder: (payload: unknown) => void;
	onCreateManualSuggestion: (payload: unknown) => void;
};

const isTrackOrderPreview = (value: unknown): value is TrackOrderPreview =>
	Boolean(value) &&
	typeof value === "object" &&
	(value as { type?: unknown }).type === "track_order" &&
	Array.isArray((value as { currentOrder?: unknown }).currentOrder) &&
	Array.isArray((value as { incomingOrder?: unknown }).incomingOrder);

const orderIds = (order: TrackOrderEntry[]) => order.map((track) => track.trackId);

const actionPayload = (
	item: MiniCutReviewItem,
	selectedOrder: "current" | "incoming" | "manual",
	trackIds: string[],
	preview: TrackOrderPreview,
) => ({
	conflictId: item.conflictId,
	reviewItemId: item.id,
	selectedOrder,
	trackIds,
	preview,
});

const TrackOrderList = ({
	title,
	order,
	movedTrackIds,
}: {
	title: string;
	order: TrackOrderEntry[];
	movedTrackIds: string[];
}) => (
	<div className="ve-review-inspector__track-order-list">
		<h3>{title}</h3>
		<ol>
			{order.map((track) => (
				<li
					key={track.trackId}
					data-moved={movedTrackIds.includes(track.trackId) ? "true" : "false"}
				>
					<span>{track.name}</span>
					<small>{track.kind}</small>
				</li>
			))}
		</ol>
	</div>
);

export const TrackOrderInspector = ({
	item,
	onApplyOrder,
	onPreserveCurrentOrder,
	onCreateManualSuggestion,
}: Props) => {
	if (!isTrackOrderPreview(item.preview)) {
		throw new Error("TrackOrderInspector requires track order preview");
	}
	const preview = item.preview;
	const initialManualOrder = preview.manualOrder ?? preview.currentOrder;
	const [manualIds, setManualIds] = useState(() => orderIds(initialManualOrder));
	const entryById = useMemo(
		() =>
			new Map(
				[...preview.currentOrder, ...preview.incomingOrder].map((entry) => [
					entry.trackId,
					entry,
				]),
			),
		[preview.currentOrder, preview.incomingOrder],
	);
	const manualOrder = manualIds.flatMap((trackId) => {
		const entry = entryById.get(trackId);
		return entry ? [entry] : [];
	});
	const move = (trackId: string, direction: -1 | 1) => {
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
	};

	return (
		<div className="ve-review-inspector__track-order">
			<div className="ve-review-inspector__track-order-grid">
				<TrackOrderList
					title="Current order"
					order={preview.currentOrder}
					movedTrackIds={preview.movedTrackIds}
				/>
				<TrackOrderList
					title="Incoming order"
					order={preview.incomingOrder}
					movedTrackIds={preview.movedTrackIds}
				/>
			</div>
			<div className="ve-review-inspector__track-order-list">
				<h3>Manual order</h3>
				<ol>
					{manualOrder.map((track, index) => (
						<li key={track.trackId}>
							<GripVertical aria-hidden="true" size={16} />
							<span>{track.name}</span>
							<small>{track.kind}</small>
							<button
								type="button"
								aria-label={`Move ${track.name} up`}
								disabled={index === 0}
								onClick={() => move(track.trackId, -1)}
							>
								Up
							</button>
							<button
								type="button"
								aria-label={`Move ${track.name} down`}
								disabled={index === manualOrder.length - 1}
								onClick={() => move(track.trackId, 1)}
							>
								Down
							</button>
						</li>
					))}
				</ol>
			</div>
			{preview.movedTrackIds.length > 0 ? (
				<p>
					Moved tracks:{" "}
					{preview.movedTrackIds
						.map((trackId) => entryById.get(trackId)?.name ?? trackId)
						.join(", ")}
				</p>
			) : null}
			<div className="ve-review-inspector__actions">
				<button
					type="button"
					onClick={() =>
						onPreserveCurrentOrder(
							actionPayload(
								item,
								"current",
								orderIds(preview.currentOrder),
								preview,
							),
						)
					}
				>
					<Check aria-hidden="true" size={16} />
					Keep current order
				</button>
				<button
					type="button"
					onClick={() =>
						onApplyOrder(
							actionPayload(
								item,
								"incoming",
								orderIds(preview.incomingOrder),
								preview,
							),
						)
					}
				>
					<Check aria-hidden="true" size={16} />
					Apply incoming order
				</button>
				<button
					type="button"
					onClick={() =>
						onCreateManualSuggestion(
							actionPayload(item, "manual", manualIds, preview),
						)
					}
				>
					<Save aria-hidden="true" size={16} />
					Save manual suggestion
				</button>
				<button
					type="button"
					onClick={() =>
						onApplyOrder(actionPayload(item, "manual", manualIds, preview))
					}
				>
					<Check aria-hidden="true" size={16} />
					Apply manual order
				</button>
			</div>
		</div>
	);
};
