import type { ExportRange } from '../render/exportRenderer'

export type ExportProgressStage = 'idle' | 'queued' | 'rendering' | 'finalizing' | 'done' | 'error'

export interface ExportProgressState {
	id: string
	range: ExportRange
	stage: ExportProgressStage
	progress: number
	updatedAt: number
	initiatedBy: string | null
	fileName?: string
	size?: number
	frameCount?: number
	error?: string
}

const exportStageLabel: Record<Exclude<ExportProgressStage, 'idle' | 'error'>, string> = {
	queued: 'queued',
	rendering: 'rendering',
	finalizing: 'finalizing',
	done: 'done',
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const clampProgressPercent = (value: unknown, fallback = 0): number => {
	const resolved = typeof value === 'number' && Number.isFinite(value) ? value : fallback
	return Math.round(clamp(resolved, 0, 100))
}

export const isExportRunning = (state: ExportProgressState | null): boolean =>
	state?.stage === 'queued' || state?.stage === 'rendering' || state?.stage === 'finalizing'

export const formatExportProgress = (state: ExportProgressState): string => {
	if (state.stage === 'error') {
		return state.error ? `failed: ${state.error}` : 'failed'
	}
	if (state.stage === 'idle') {
		return 'idle'
	}
	const stage = exportStageLabel[state.stage]
	return `${stage} ${clampProgressPercent(state.progress)}%`
}
