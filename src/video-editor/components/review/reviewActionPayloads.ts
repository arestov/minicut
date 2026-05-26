import type {
	ClipTimingPreview,
	ClipTimingVariant,
} from "../../dkt/review/features/clipTiming";
import type {
	DeleteVsEditPreview,
} from "../../dkt/review/features/deleteVsEdit";
import type { DanglingResourcePreview } from "../../dkt/review/features/danglingResource";
import type {
	TrackOrderEntry,
	TrackOrderPreview,
} from "../../dkt/review/features/trackOrder";
import type { MiniCutReviewItem } from "../../dkt/review/types";

export type ClipTimingResolveChoice = "current" | "incoming" | "custom";
export type TrackOrderResolveChoice = "current" | "incoming" | "manual";
export type DanglingRelinkFormState = {
	replacementUrl: string;
	sourceKind: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertReviewPreview = <Preview extends { type: string }>(
	item: MiniCutReviewItem,
	type: Preview["type"],
): Preview => {
	if (!isRecord(item.preview) || item.preview.type !== type) {
		throw new Error(`Review item ${item.id} requires ${type} preview`);
	}
	return item.preview as Preview;
};

const textValue = (value: unknown, fallback = ""): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const clipIdFromItem = (item: MiniCutReviewItem): string => {
	const clipId = item.affectedObjects.find((object) => object.type === "clip")?.id;
	if (!clipId) {
		throw new Error(`Review item ${item.id} has no affected clip id`);
	}
	return clipId;
};

const assertTimingVariant = (
	item: MiniCutReviewItem,
	variant: unknown,
): ClipTimingVariant => {
	if (!isRecord(variant)) {
		throw new Error(`Review item ${item.id} has no clip timing variant`);
	}
	for (const field of ["start", "in", "duration"] as const) {
		if (typeof variant[field] !== "number" || !Number.isFinite(variant[field])) {
			throw new Error(`Review item ${item.id} has invalid ${field} timing`);
		}
	}
	return {
		start: variant.start,
		in: variant.in,
		duration: variant.duration,
		fadeIn:
			typeof variant.fadeIn === "number" && Number.isFinite(variant.fadeIn)
				? variant.fadeIn
				: 0,
		fadeOut:
			typeof variant.fadeOut === "number" && Number.isFinite(variant.fadeOut)
				? variant.fadeOut
				: 0,
	};
};

export const buildClipTimingResolvePayload = (
	item: MiniCutReviewItem,
	selectedVariant: ClipTimingResolveChoice,
	customTiming?: Partial<ClipTimingVariant>,
) => {
	const preview = assertReviewPreview<ClipTimingPreview>(item, "clip_timing");
	const timing = assertTimingVariant(
		item,
		selectedVariant === "current"
			? preview.current
			: selectedVariant === "incoming"
				? preview.incoming
				: customTiming,
	);
	return {
		conflictId: item.conflictId,
		reviewItemId: item.id,
		selectedVariant,
		start: timing.start,
		in: timing.in,
		duration: timing.duration,
		fadeIn: timing.fadeIn,
		fadeOut: timing.fadeOut,
	};
};

export const buildClipTimingParkPayload = (item: MiniCutReviewItem) => {
	const preview = assertReviewPreview<ClipTimingPreview>(item, "clip_timing");
	return {
		conflictId: item.conflictId,
		reviewItemId: item.id,
		clipId: clipIdFromItem(item),
		variant: "incoming",
		timing: assertTimingVariant(item, preview.incoming),
	};
};

const orderIds = (order: TrackOrderEntry[]) => order.map((track) => track.trackId);

export const trackOrderIds = orderIds;

export const buildTrackOrderPayload = (
	item: MiniCutReviewItem,
	selectedOrder: TrackOrderResolveChoice,
	trackIds?: string[],
) => {
	const preview = assertReviewPreview<TrackOrderPreview>(item, "track_order");
	const resolvedTrackIds =
		trackIds ??
		(selectedOrder === "current"
			? orderIds(preview.currentOrder)
			: selectedOrder === "incoming"
				? orderIds(preview.incomingOrder)
				: preview.manualOrder
					? orderIds(preview.manualOrder)
					: null);
	if (!resolvedTrackIds) {
		throw new Error(`Review item ${item.id} has no manual track order`);
	}
	return {
		conflictId: item.conflictId,
		reviewItemId: item.id,
		selectedOrder,
		trackIds: resolvedTrackIds,
		preview,
	};
};

const buildDeleteVsEditPayload = (item: MiniCutReviewItem) => {
	const preview = assertReviewPreview<DeleteVsEditPreview>(item, "delete_vs_edit");
	return {
		conflictId: item.conflictId,
		reviewItemId: item.id,
		clipId: preview.deletedVariant.clipId,
		targetTrackId:
			preview.restoreTarget?.trackId ??
			textValue(preview.editedVariant.clipAttrs.targetTrackId),
		deletedVariant: preview.deletedVariant,
		editedVariant: preview.editedVariant,
	};
};

export const buildDeleteVsEditRestorePayload = buildDeleteVsEditPayload;
export const buildDeleteVsEditParkPayload = buildDeleteVsEditPayload;
export const buildDeleteVsEditArchivePayload = buildDeleteVsEditPayload;

const danglingBase = (item: MiniCutReviewItem) => {
	const preview = assertReviewPreview<DanglingResourcePreview>(
		item,
		"dangling_resource",
	);
	return {
		preview,
		base: {
			conflictId: item.conflictId,
			reviewItemId: item.id,
			resourceId: preview.resourceId,
			affectedClipIds: preview.clipIds,
		},
	};
};

export const buildDanglingRelinkPayload = (
	item: MiniCutReviewItem,
	formState: DanglingRelinkFormState,
) => {
	const { preview, base } = danglingBase(item);
	const replacementUrl = formState.replacementUrl.trim();
	if (!replacementUrl || !formState.sourceKind) {
		throw new Error(`Review item ${item.id} requires replacement media source`);
	}
	return {
		...base,
		replacementUrl,
		source: {
			...(isRecord(preview.lastKnownSource) ? preview.lastKnownSource : {}),
			kind: formState.sourceKind,
			url: replacementUrl,
		},
		data: { relinkedFromReview: true },
	};
};

export const buildDanglingOfflinePayload = (item: MiniCutReviewItem) =>
	danglingBase(item).base;
