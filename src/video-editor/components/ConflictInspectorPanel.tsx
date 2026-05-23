import { useMemo } from "react";
import type { MiniCutReviewItem } from "../dkt/review/types";
import { ReviewPanel } from "./review/ReviewPanel";

type ConflictDecision = {
	start?: number;
	in?: number;
	duration?: number;
};

export type ClipConflictItem = {
	id: string;
	kind: string;
	scope: string;
	summary: string;
	decision?: ConflictDecision;
};

type ConflictInspectorModel = {
	states?: Record<string, unknown>;
	dispatch?: (actionName: string, payload?: unknown) => void | Promise<void>;
};

type ConflictInspectorPanelProps = {
	model: ConflictInspectorModel;
	conflicts: ClipConflictItem[];
	onClose?: () => void;
};

const reviewKindForConflict = (
	conflict: ClipConflictItem,
): MiniCutReviewItem["kind"] => {
	if (conflict.scope === "clipTiming" || conflict.decision) {
		return "clip_timing";
	}
	if (conflict.kind?.toLowerCase().includes("delete")) {
		return "delete_vs_edit";
	}
	if (conflict.kind?.toLowerCase().includes("dangling")) {
		return "dangling_resource";
	}
	if (conflict.kind?.toLowerCase().includes("track")) {
		return "track_order";
	}
	return "unknown";
};

const reviewItemFromLegacyConflict = (
	conflict: ClipConflictItem,
): MiniCutReviewItem => {
	const kind = reviewKindForConflict(conflict);
	return {
		id: `review:${conflict.id}`,
		conflictId: conflict.id,
		projectId: "legacy-clip-scope",
		kind,
		status: "open",
		title: conflict.summary ?? conflict.kind ?? "CRDT conflict",
		affectedObjects: [],
		preview: {
			type: kind,
			conflictId: conflict.id,
			decision: conflict.decision ?? null,
		},
		availableActions:
			kind === "clip_timing" ? ["resolveClipTimingConflict"] : [],
		source: { conflictId: conflict.id },
	};
};

export const ConflictInspectorPanel = ({
	model,
	conflicts,
	onClose,
}: ConflictInspectorPanelProps) => {
	const items = useMemo(
		() => conflicts.map(reviewItemFromLegacyConflict),
		[conflicts],
	);
	const dispatch = (actionName: string, payload?: unknown) => {
		void model.dispatch?.(actionName, payload);
	};

	return (
		<ReviewPanel
			items={items}
			onClose={onClose}
			onAcknowledgeReviewItem={(item) =>
				dispatch("acknowledgeReviewItem", {
					conflict_id: item.conflictId,
					review_item_id: item.id,
				})
			}
			onReviewAction={(actionId, item) =>
				dispatch(actionId, {
					conflict_id: item.conflictId,
					review_item_id: item.id,
				})
			}
		/>
	);
};
