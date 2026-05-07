import type { ExportBackend, ExportDiagnostics, ExportRange } from './exportTypes'
import { compileEditframeClipsFromPlan, type ClipFrameOperation, type EditframeClip, type ExportPlan } from './renderPlan'

export interface ResolvedExportRange {
	start: number
	duration: number
	clipIds: Set<string> | null
}

const getExportBoundsFromPlan = (plan: ExportPlan, range: ExportRange): { start: number; duration: number } => {
	if (range.type === 'project') {
		return { start: 0, duration: plan.duration }
	}

	const source = plan.clipSources.find((s) => s.id === range.clipId)
	if (!source) {
		throw new Error(`Unknown clip ${range.clipId}`)
	}
	return { start: source.start, duration: source.duration }
}

export const resolveExportRange = (
	plan: ExportPlan,
	range: ExportRange,
): ResolvedExportRange => {
	const bounds = getExportBoundsFromPlan(plan, range)
	if (range.type === 'project') {
		return { ...bounds, clipIds: null }
	}

	return { ...bounds, clipIds: new Set([range.clipId]) }
}

export const filterClipsForRange = (
	operations: ClipFrameOperation[],
	resolvedRange: ResolvedExportRange,
): ClipFrameOperation[] => resolvedRange.clipIds
	? operations.filter((operation) => resolvedRange.clipIds?.has(operation.clipId))
	: operations

export const getRangeClips = (plan: ExportPlan, resolvedRange: ResolvedExportRange): EditframeClip[] => {
	const clips = compileEditframeClipsFromPlan(plan)
	if (!resolvedRange.clipIds) {
		return clips
	}

	return clips.filter((clip) => resolvedRange.clipIds?.has(clip.id))
}

export const createExportDiagnostics = (
	backend: ExportBackend,
	plan: ExportPlan,
	resolvedRange: ResolvedExportRange,
	fallbackReason?: string,
): ExportDiagnostics => ({
	backend,
	...(fallbackReason ? { fallbackReason } : {}),
	resolvedClipIds: getRangeClips(plan, resolvedRange).map((clip) => clip.id),
})

export const getRangeName = (plan: ExportPlan, range: ExportRange): string => {
	if (range.type === 'clip') {
		return plan.clipSources.find((s) => s.id === range.clipId)?.name ?? 'clip'
	}
	return 'project'
}