import type {
	PreviewClipSource,
	PreviewStructure,
} from "../../read-model/previewComps";
import type { MiniCutReviewItem } from "../../dkt/review/types";
import type { MiniCutReviewSessionSnapshot } from "../ReviewSession";

export const reduceProjectPreviewClipSources = (
	allTrackClipData: unknown,
): PreviewStructure => {
	const sources: PreviewClipSource[] = [];
	if (Array.isArray(allTrackClipData)) {
		for (const clipData of allTrackClipData) {
			if (clipData && typeof clipData === "object" && "id" in clipData) {
				sources.push(clipData as PreviewClipSource);
			}
		}
	}
	return { clipSources: sources };
};

export const reduceProjectReviewModels = (
	projectId: unknown,
	models: unknown,
	projectIds: unknown,
): unknown[] => {
	if (typeof projectId !== "string" || !projectId || !Array.isArray(models)) {
		return [];
	}
	const ids = Array.isArray(projectIds) ? projectIds : [];
	return models.filter((_model, index) => ids[index] === projectId);
};

export type ProjectReviewSnapshot = {
	session: MiniCutReviewSessionSnapshot | null;
	openCount: number;
};

const normalizeSnapshots = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value.filter(Boolean) as Value[]) : [];

export const reduceProjectReviewSnapshot = (
	projectId: unknown,
	reviewSessions: unknown,
	reviewItems: unknown,
): ProjectReviewSnapshot => {
	if (typeof projectId !== "string" || !projectId) {
		return { session: null, openCount: 0 };
	}

	const items = normalizeSnapshots<MiniCutReviewItem>(reviewItems);
	const sessions = normalizeSnapshots<MiniCutReviewSessionSnapshot>(
		reviewSessions,
	);
	const openCount = items.filter((item) => item.status !== "resolved").length;
	const session =
		sessions.find(() => openCount > 0) ??
		sessions[0] ??
		(items.length
			? {
					id: `review-session:${projectId}`,
					projectId,
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
			activitySummaries: session.activitySummaries ?? [],
		},
	};
};
