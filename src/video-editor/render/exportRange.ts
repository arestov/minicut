import { getProjectEntity, getTrackEnd, getTracks } from './registrySelectors'
import type { ClipAttrs, Entity, ProjectRegistry } from './registryTypes'
import type { ExportBackend, ExportDiagnostics, ExportRange } from './exportTypes'
import { compileEditframeClips, type ClipFrameOperation, type EditframeClip } from './renderPlan'

export interface ResolvedExportRange {
	start: number
	duration: number
	clipIds: Set<string> | null
}

const getProjectDuration = (registry: ProjectRegistry, projectId: string): number => {
	const project = registry.projects[projectId]
	if (!project) {
		throw new Error(`Unknown project ${projectId}`)
	}

	return getTracks(registry, project).reduce((duration, track) => Math.max(duration, getTrackEnd(registry, track.id)), 0)
}

export const getClipEntity = (registry: ProjectRegistry, clipId: string): Entity => {
	const clip = registry.entitiesById[clipId]
	if (!clip || clip.type !== 'clip') {
		throw new Error(`Unknown clip ${clipId}`)
	}

	return clip
}

const getExportBounds = (registry: ProjectRegistry, projectId: string, range: ExportRange): { start: number; duration: number } => {
	if (range.type === 'project') {
		return { start: 0, duration: getProjectDuration(registry, projectId) }
	}

	const attrs = getClipEntity(registry, range.clipId).attrs as unknown as ClipAttrs
	return { start: attrs.start, duration: attrs.duration }
}

const getLinkedClipIds = (registry: ProjectRegistry, clipId: string): string[] => {
	const clip = getClipEntity(registry, clipId)
	const linked = new Set<string>()
	for (const value of [clip.rels.linkedAudioClip, clip.rels.linkedVideoClip]) {
		if (typeof value === 'string') {
			linked.add(value)
		}
	}

	for (const entity of Object.values(registry.entitiesById)) {
		if (entity?.type !== 'clip') {
			continue
		}
		if (entity.rels.linkedAudioClip === clipId || entity.rels.linkedVideoClip === clipId) {
			linked.add(entity.id)
		}
	}

	return Array.from(linked).filter((id) => id !== clipId && registry.entitiesById[id]?.type === 'clip')
}

export const resolveExportRange = (
	registry: ProjectRegistry,
	projectId: string,
	range: ExportRange,
): ResolvedExportRange => {
	const bounds = getExportBounds(registry, projectId, range)
	if (range.type === 'project') {
		return { ...bounds, clipIds: null }
	}

	return {
		...bounds,
		clipIds: new Set([range.clipId, ...getLinkedClipIds(registry, range.clipId)]),
	}
}

export const filterClipsForRange = (
	operations: ClipFrameOperation[],
	resolvedRange: ResolvedExportRange,
): ClipFrameOperation[] => resolvedRange.clipIds
	? operations.filter((operation) => resolvedRange.clipIds?.has(operation.clipId))
	: operations

export const getRangeClips = (registry: ProjectRegistry, projectId: string, resolvedRange: ResolvedExportRange): EditframeClip[] => {
	const clips = compileEditframeClips(registry, projectId)
	if (!resolvedRange.clipIds) {
		return clips
	}

	return clips.filter((clip) => resolvedRange.clipIds?.has(clip.id))
}

const getResolvedClipIds = (
	registry: ProjectRegistry,
	projectId: string,
	resolvedRange: ResolvedExportRange,
): string[] => getRangeClips(registry, projectId, resolvedRange).map((clip) => clip.id)

export const createExportDiagnostics = (
	backend: ExportBackend,
	registry: ProjectRegistry,
	projectId: string,
	resolvedRange: ResolvedExportRange,
	fallbackReason?: string,
): ExportDiagnostics => ({
	backend,
	...(fallbackReason ? { fallbackReason } : {}),
	resolvedClipIds: getResolvedClipIds(registry, projectId, resolvedRange),
})

const getProjectTitle = (registry: ProjectRegistry, projectId: string): string => {
	const project = registry.projects[projectId]
	if (!project) {
		return 'project'
	}

	return String(getProjectEntity(registry, project).attrs.title ?? 'project')
}

export const getRangeName = (registry: ProjectRegistry, projectId: string, range: ExportRange): string =>
	range.type === 'clip'
		? String(getClipEntity(registry, range.clipId).attrs.name ?? 'clip')
		: getProjectTitle(registry, projectId)