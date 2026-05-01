import { getProjectEntity, getTrackEnd, getTracks } from '../domain/selectors'
import type { ClipAttrs, Entity, ProjectRegistry } from '../domain/types'
import { compileEditframeClips, compileFrameOperations, type ClipFrameOperation, type EditframeClip } from './renderPlan'

export type ExportFormat = 'json-manifest'

export type ExportRange =
	| { type: 'project' }
	| { type: 'clip'; clipId: string }

export interface ExportRenderRequest {
	registry: ProjectRegistry
	projectId: string
	range: ExportRange
	format?: ExportFormat
	fps?: number
}

export interface ExportProgressEvent {
	stage: 'queued' | 'rendering' | 'finalizing' | 'done'
	progress: number
}

export interface ExportFrameSample {
	index: number
	time: number
	operations: ClipFrameOperation[]
}

export interface ExportManifest {
	format: ExportFormat
	projectId: string
	range: ExportRange
	start: number
	duration: number
	fps: number
	frameCount: number
	clips: EditframeClip[]
	frames: ExportFrameSample[]
}

export interface ExportRenderResult {
	id: string
	fileName: string
	mimeType: string
	blob: Blob
	size: number
	duration: number
	frameCount: number
	manifest: ExportManifest
	downloadUrl?: string
}

export interface ExportRenderer {
	render(
		request: ExportRenderRequest,
		onProgress?: (event: ExportProgressEvent) => void,
	): Promise<ExportRenderResult>
}

const manifestMimeType = 'application/vnd.minicut.export+json'

const sanitizeFileNamePart = (value: string): string =>
	value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export'

const getProjectDuration = (registry: ProjectRegistry, projectId: string): number => {
	const project = registry.projects[projectId]
	if (!project) {
		throw new Error(`Unknown project ${projectId}`)
	}

	return getTracks(registry, project).reduce((duration, track) => Math.max(duration, getTrackEnd(registry, track.id)), 0)
}

const getClipEntity = (registry: ProjectRegistry, clipId: string): Entity => {
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

const filterClipsForRange = (
	operations: ClipFrameOperation[],
	range: ExportRange,
): ClipFrameOperation[] => range.type === 'clip'
	? operations.filter((operation) => operation.clipId === range.clipId)
	: operations

const getRangeClips = (registry: ProjectRegistry, projectId: string, range: ExportRange): EditframeClip[] => {
	const clips = compileEditframeClips(registry, projectId)
	if (range.type === 'project') {
		return clips
	}

	return clips.filter((clip) => clip.id === range.clipId)
}

const getFrameCount = (duration: number, fps: number): number =>
	Math.max(1, Math.ceil(duration * fps))

const getProjectTitle = (registry: ProjectRegistry, projectId: string): string => {
	const project = registry.projects[projectId]
	if (!project) {
		return 'project'
	}

	return String(getProjectEntity(registry, project).attrs.title ?? 'project')
}

const createExportId = (): string => {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID()
	}

	return `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const createManifestExportRenderer = (): ExportRenderer => ({
	async render(request, onProgress) {
		const format = request.format ?? 'json-manifest'
		if (format !== 'json-manifest') {
			throw new Error(`Unsupported export format ${format}`)
		}

		const fps = request.fps ?? 30
		if (!Number.isFinite(fps) || fps <= 0) {
			throw new Error('Export fps must be positive')
		}

		if (!request.registry.projects[request.projectId]) {
			throw new Error(`Unknown project ${request.projectId}`)
		}

		onProgress?.({ stage: 'queued', progress: 0 })
		const { start, duration } = getExportBounds(request.registry, request.projectId, request.range)
		const frameCount = getFrameCount(duration, fps)
		const frames: ExportFrameSample[] = []

		for (let index = 0; index < frameCount; index += 1) {
			const time = start + index / fps
			frames.push({
				index,
				time,
				operations: filterClipsForRange(
					compileFrameOperations(request.registry, request.projectId, time),
					request.range,
				),
			})
			onProgress?.({ stage: 'rendering', progress: (index + 1) / frameCount })
		}

		onProgress?.({ stage: 'finalizing', progress: 1 })
		const manifest: ExportManifest = {
			format,
			projectId: request.projectId,
			range: request.range,
			start,
			duration,
			fps,
			frameCount,
			clips: getRangeClips(request.registry, request.projectId, request.range),
			frames,
		}
		const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: manifestMimeType })
		const rangeName = request.range.type === 'clip'
			? String(getClipEntity(request.registry, request.range.clipId).attrs.name ?? 'clip')
			: getProjectTitle(request.registry, request.projectId)
		const result: ExportRenderResult = {
			id: createExportId(),
			fileName: `${sanitizeFileNamePart(rangeName)}.minicut-export.json`,
			mimeType: manifestMimeType,
			blob,
			size: blob.size,
			duration,
			frameCount,
			manifest,
		}
		onProgress?.({ stage: 'done', progress: 1 })

		return result
	},
})
