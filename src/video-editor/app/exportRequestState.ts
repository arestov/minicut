import type { ExportRange } from '../render/exportRenderer'
import type { ExportPlan } from '../render/renderPlan'

export type ExportRequestFormat = 'video-webm'

export interface ExportRequestState {
	id: string
	range: ExportRange
	format: ExportRequestFormat
	plan: ExportPlan
	requestedAt: number
	initiatedBy: string | null
}

const asObject = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' ? value as Record<string, unknown> : null

const asString = (value: unknown): string | null => typeof value === 'string' && value ? value : null

const parseRange = (value: unknown): ExportRange | null => {
	const range = asObject(value)
	if (!range) {
		return null
	}
	if (range.type === 'project') {
		return { type: 'project' }
	}
	if (range.type === 'clip' && typeof range.clipId === 'string' && range.clipId) {
		return { type: 'clip', clipId: range.clipId }
	}
	return null
}

const parsePlan = (value: unknown): ExportPlan | null => {
	const plan = asObject(value)
	if (!plan || typeof plan.projectId !== 'string' || !Array.isArray(plan.clipSources)) {
		return null
	}
	return {
		projectId: plan.projectId,
		fps: typeof plan.fps === 'number' && Number.isFinite(plan.fps) ? plan.fps : 30,
		width: typeof plan.width === 'number' && Number.isFinite(plan.width) ? plan.width : 1920,
		height: typeof plan.height === 'number' && Number.isFinite(plan.height) ? plan.height : 1080,
		duration: typeof plan.duration === 'number' && Number.isFinite(plan.duration) ? plan.duration : 0,
		clipSources: plan.clipSources,
	}
}

export const parseExportRequest = (value: unknown): ExportRequestState | null => {
	const request = asObject(value)
	if (!request) {
		return null
	}
	const id = asString(request.id)
	const range = parseRange(request.range)
	const plan = parsePlan(request.plan)
	if (!id || !range || !plan) {
		return null
	}
	const format: ExportRequestFormat = request.format === 'video-webm' ? 'video-webm' : 'video-webm'
	return {
		id,
		range,
		format,
		plan,
		requestedAt: typeof request.requestedAt === 'number' && Number.isFinite(request.requestedAt) ? request.requestedAt : Date.now(),
		initiatedBy: asString(request.initiatedBy),
	}
}