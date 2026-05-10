import type {
	ExportBackend,
	ExportDiagnostics,
	ExportRange,
} from "./exportTypes";
import {
	type ClipFrameOperation,
	compileEditframeClipsFromPlan,
	type EditframeClip,
	type ExportPlan,
} from "./renderPlan";

export interface ResolvedExportRange {
	start: number;
	duration: number;
	clipIds: Set<string> | null;
}

const getExportBoundsFromPlan = (
	plan: ExportPlan,
	range: ExportRange,
): { start: number; duration: number } => {
	if (range.type === "project") {
		return { start: 0, duration: plan.duration };
	}

	const source = plan.clipSources.find((s) => s.id === range.clipId);
	if (!source) {
		throw new Error(`Unknown clip ${range.clipId}`);
	}
	return { start: source.start, duration: source.duration };
};

const resolveClipIdsForClipExport = (
	plan: ExportPlan,
	clipId: string,
): Set<string> => {
	const selectedSource = plan.clipSources.find(
		(source) => source.id === clipId,
	);
	if (!selectedSource) {
		return new Set([clipId]);
	}

	const clipIds = new Set<string>([clipId]);
	if (selectedSource.resourceKind === "video" && selectedSource.resourceId) {
		for (const source of plan.clipSources) {
			if (source.id === clipId) {
				continue;
			}
			if (
				source.resourceKind === "audio" &&
				source.resourceId === selectedSource.resourceId
			) {
				clipIds.add(source.id);
			}
		}
	}

	return clipIds;
};

export const resolveExportRange = (
	plan: ExportPlan,
	range: ExportRange,
): ResolvedExportRange => {
	const bounds = getExportBoundsFromPlan(plan, range);
	if (range.type === "project") {
		return { ...bounds, clipIds: null };
	}

	return {
		...bounds,
		clipIds: resolveClipIdsForClipExport(plan, range.clipId),
	};
};

export const filterClipsForRange = (
	operations: ClipFrameOperation[],
	resolvedRange: ResolvedExportRange,
): ClipFrameOperation[] =>
	resolvedRange.clipIds
		? operations.filter((operation) =>
				resolvedRange.clipIds?.has(operation.clipId),
			)
		: operations;

export const getRangeClips = (
	plan: ExportPlan,
	resolvedRange: ResolvedExportRange,
): EditframeClip[] => {
	const clips = compileEditframeClipsFromPlan(plan);
	if (!resolvedRange.clipIds) {
		return clips;
	}

	return clips.filter((clip) => resolvedRange.clipIds?.has(clip.id));
};

export const createExportDiagnostics = (
	backend: ExportBackend,
	plan: ExportPlan,
	resolvedRange: ResolvedExportRange,
	fallbackReason?: string,
): ExportDiagnostics => {
	const resolvedClips = getRangeClips(plan, resolvedRange);
	return {
		backend,
		...(fallbackReason ? { fallbackReason } : {}),
		resolvedClipIds: resolvedClips.map((clip) => clip.id),
		resolvedClipTypes: resolvedClips.map((clip) => clip.type),
		audioClipCount: resolvedClips.filter((clip) => clip.type === "ef-audio")
			.length,
	};
};

export const getRangeName = (plan: ExportPlan, range: ExportRange): string => {
	if (range.type === "clip") {
		return plan.clipSources.find((s) => s.id === range.clipId)?.name ?? "clip";
	}
	return "project";
};
