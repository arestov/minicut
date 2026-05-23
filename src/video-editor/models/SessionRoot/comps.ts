import {
	createPreviewFrame,
	lookupPreviewBufferFrame,
	type PreviewBuffer,
	type PreviewFrame,
	type PreviewStructure,
} from "../../read-model/previewComps";
import type {
	MiniCutActivitySummary,
	MiniCutReviewItem,
} from "../../dkt/review/types";
import type { MiniCutReviewSessionSnapshot } from "../ReviewSession";

const DEFAULT_PREVIEW_STRUCTURE: PreviewStructure = { clipSources: [] };

export const reducePreviewStructure = (
	previewClipSources: unknown,
): PreviewStructure => {
	if (
		previewClipSources &&
		typeof previewClipSources === "object" &&
		Array.isArray((previewClipSources as PreviewStructure).clipSources)
	) {
		return previewClipSources as PreviewStructure;
	}
	return DEFAULT_PREVIEW_STRUCTURE;
};

export const reducePreviewFrame = (
	previewStructure: unknown,
	cursor: unknown,
	previewBuffer: unknown,
	isPlaying: unknown,
): PreviewFrame => {
	const time =
		typeof cursor === "number" && Number.isFinite(cursor) ? cursor : 0;
	if (isPlaying) {
		const buffered = lookupPreviewBufferFrame(
			previewBuffer as PreviewBuffer | null,
			time,
		);
		if (buffered) return buffered;
	}
	return createPreviewFrame(
		previewStructure &&
			typeof previewStructure === "object" &&
			Array.isArray((previewStructure as { clipSources?: unknown }).clipSources)
			? (previewStructure as PreviewStructure)
			: DEFAULT_PREVIEW_STRUCTURE,
		time,
	);
};

export const reduceSelectedClip = (
	clips: unknown,
	selectedEntityId: unknown,
) => {
	if (typeof selectedEntityId !== "string" || !selectedEntityId) return null;
	const modelList = Array.isArray(clips) ? clips : [];

	for (const clipModel of modelList) {
		if (!clipModel || typeof clipModel !== "object") {
			continue;
		}
		const nodeId = (clipModel as { _node_id?: unknown; _nodeId?: unknown })
			._node_id;
		const nodeIdCamel = (clipModel as { _node_id?: unknown; _nodeId?: unknown })
			._nodeId;
		if (
			(typeof nodeId === "string" && nodeId === selectedEntityId) ||
			(typeof nodeIdCamel === "string" && nodeIdCamel === selectedEntityId)
		) {
			return clipModel;
		}
	}

	return null;
};

export type ActiveProjectReviewSnapshot = {
	session: MiniCutReviewSessionSnapshot | null;
	openCount: number;
};

const hasProjectId = <Value extends { projectId: string }>(
	value: Value,
	projectId: string,
): boolean => value.projectId === projectId;

const normalizeSnapshots = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value.filter(Boolean) as Value[]) : [];

export const reduceActiveProjectReviewSnapshot = (
	activeProjectId: unknown,
	reviewSessions: unknown,
	reviewItems: unknown,
	activitySummaries: unknown,
): ActiveProjectReviewSnapshot => {
	if (typeof activeProjectId !== "string" || !activeProjectId) {
		return { session: null, openCount: 0 };
	}

	const items = normalizeSnapshots<MiniCutReviewItem>(reviewItems).filter((item) =>
		hasProjectId(item, activeProjectId),
	);
	const summaries = normalizeSnapshots<MiniCutActivitySummary>(
		activitySummaries,
	).filter((summary) => hasProjectId(summary, activeProjectId));
	const sessions = normalizeSnapshots<MiniCutReviewSessionSnapshot>(
		reviewSessions,
	).filter((session) => hasProjectId(session, activeProjectId));
	const openCount = items.filter((item) => item.status !== "resolved").length;
	const session =
		sessions.find(() => openCount > 0) ??
		sessions[0] ??
		(items.length || summaries.length
			? {
					id: `review-session:${activeProjectId}`,
					projectId: activeProjectId,
					selectedReviewItemId: items[0]?.id ?? null,
					items: [],
					activitySummaries: [],
				}
			: null);

	if (!session) {
		return { session: null, openCount: 0 };
	}

	return {
		openCount,
		session: {
			...session,
			selectedReviewItemId: session.selectedReviewItemId ?? items[0]?.id ?? null,
			items,
			activitySummaries: summaries,
		},
	};
};
