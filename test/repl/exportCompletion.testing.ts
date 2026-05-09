/**
 * TESTING AND DEBUG ONLY — DO NOT USE IN PRODUCTION CODE
 *
 * Export pipeline completion helpers for jsdom/browser tests and REPL.
 *
 * Provides event-driven waiting for export pipeline stages without polling.
 * Tests can await specific export states (queued, rendering, done, error)
 * and verify the full pipeline completed correctly.
 *
 * Usage (jsdom REPL):
 *
 *   import { createExportCompletionTracker } from './exportCompletion.testing'
 *
 *   const tracker = createExportCompletionTracker(pageRuntime)
 *   dispatchRoot('requestProjectExport', { id: 'test-1', initiatedBy: 'test' })
 *   const result = await tracker.waitForExportDone('test-1', { timeoutMs: 5000 })
 *   expect(result.stage).toBe('done')
 *   tracker.destroy()
 *
 * Usage (browser test):
 *
 *   const tracker = createExportCompletionTracker(pageRuntime)
 *   await page.click('[label="Export project"]')
 *   const result = await tracker.waitForExportDone(undefined, { timeoutMs: 10000 })
 *   tracker.destroy()
 */

import type { PageSyncRuntime } from '../../src/dkt-react-sync/runtime/PageSyncRuntime'
import type { ExportProgressState } from '../../src/video-editor/app/exportProgressState'
import type { ExportRequestState } from '../../src/video-editor/app/exportRequestState'
import { parseExportRequest } from '../../src/video-editor/app/exportRequestState'

type ExportProgressStage = ExportProgressState['stage']

export interface ExportCompletionResult {
	exportId: string
	stage: ExportProgressStage
	progress: number
	fileName?: string
	size?: number
	frameCount?: number
	error?: string
}

export interface ExportRequestResult {
	exportId: string
	range: ExportRequestState['range']
	initiatedBy: string | null
}

export interface ExportCompletionTracker {
	waitForExportStage(
		stage: ExportProgressStage | readonly ExportProgressStage[],
		options?: { exportId?: string; timeoutMs?: number },
	): Promise<ExportCompletionResult>

	waitForExportDone(
		exportId?: string,
		options?: { timeoutMs?: number },
	): Promise<ExportCompletionResult>

	waitForExportRequest(
		options?: { timeoutMs?: number },
	): Promise<ExportRequestResult>

	waitForExportProgress(
		minProgress: number,
		options?: { exportId?: string; timeoutMs?: number },
	): Promise<ExportCompletionResult>

	destroy(): void
}

const parseProgress = (value: unknown): ExportProgressState | null => {
	if (value && typeof value === 'object' && 'stage' in value) {
		return value as ExportProgressState
	}
	return null
}

const DEFAULT_TIMEOUT = 10000

export const createExportCompletionTracker = (
	pageRuntime: PageSyncRuntime | null,
): ExportCompletionTracker => {
	if (!pageRuntime) {
		throw new Error('PageSyncRuntime is required for export completion tracker')
	}

	type Resolver = {
		resolve: (value: ExportCompletionResult | ExportRequestResult) => void
		reject: (error: Error) => void
		exportId: string | undefined
		matches: (progress: ExportProgressState) => boolean
		timeoutId: ReturnType<typeof setTimeout>
	}

	const progressResolvers: Resolver[] = []
	const requestResolvers: Array<{
		resolve: (value: ExportRequestResult) => void
		reject: (error: Error) => void
		timeoutId: ReturnType<typeof setTimeout>
	}> = []

	let currentProgress: ExportProgressState | null = null

	const checkProgressResolvers = () => {
		if (!currentProgress) return

		for (let i = progressResolvers.length - 1; i >= 0; i--) {
			const resolver = progressResolvers[i]
			if (resolver.matches(currentProgress)) {
				if (resolver.exportId && currentProgress.id !== resolver.exportId) {
					continue
				}
				clearTimeout(resolver.timeoutId)
				progressResolvers.splice(i, 1)
				resolver.resolve({
					exportId: currentProgress.id,
					stage: currentProgress.stage,
					progress: currentProgress.progress,
					fileName: currentProgress.fileName,
					size: currentProgress.size,
					frameCount: currentProgress.frameCount,
					error: currentProgress.error,
				})
			}
		}
	}

	const unlistenProgress = pageRuntime.subscribeRootAttrs(['exportProgress'], () => {
		const attrs = pageRuntime.getRootAttrs(['exportProgress']) as { exportProgress?: unknown }
		const parsed = parseProgress(attrs.exportProgress)
		if (!parsed) return
		currentProgress = parsed
		checkProgressResolvers()
	})

	const unlistenRequest = pageRuntime.subscribeExportRequests?.((payload) => {
		const request = parseExportRequest(payload)
		if (!request) return

		for (let i = requestResolvers.length - 1; i >= 0; i--) {
			const resolver = requestResolvers[i]
			clearTimeout(resolver.timeoutId)
			requestResolvers.splice(i, 1)
			resolver.resolve({
				exportId: request.id,
				range: request.range,
				initiatedBy: request.initiatedBy,
			})
		}
	}) ?? (() => {})

	const waitForExportStage = (
		stage: ExportProgressStage | readonly ExportProgressStage[],
		options: { exportId?: string; timeoutMs?: number } = {},
	): Promise<ExportCompletionResult> => {
		const stages = Array.isArray(stage) ? stage : [stage]
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT

		if (currentProgress) {
			const idMatch = !options.exportId || currentProgress.id === options.exportId
			if (idMatch && stages.includes(currentProgress.stage)) {
				return Promise.resolve({
					exportId: currentProgress.id,
					stage: currentProgress.stage,
					progress: currentProgress.progress,
					fileName: currentProgress.fileName,
					size: currentProgress.size,
					frameCount: currentProgress.frameCount,
					error: currentProgress.error,
				})
			}
		}

		return new Promise<ExportCompletionResult>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const idx = progressResolvers.findIndex((r) => r.timeoutId === timeoutId)
				if (idx !== -1) progressResolvers.splice(idx, 1)
				reject(new Error(
					`Export did not reach stage ${stages.join('/')}${options.exportId ? ` (id=${options.exportId})` : ''} within ${timeoutMs}ms. `
					+ `Current: ${currentProgress ? `${currentProgress.stage} ${currentProgress.progress}%` : 'null'}`,
				))
			}, timeoutMs)

			progressResolvers.push({
				resolve: resolve as Resolver['resolve'],
				reject,
				exportId: options.exportId,
				matches: (progress) => stages.includes(progress.stage),
				timeoutId,
			})
		})
	}

	const waitForExportDone = (
		exportId?: string,
		options: { timeoutMs?: number } = {},
	): Promise<ExportCompletionResult> => {
		return waitForExportStage(['done', 'error'], {
			exportId,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
		})
	}

	const waitForExportRequest = (
		options: { timeoutMs?: number } = {},
	): Promise<ExportRequestResult> => {
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT

		return new Promise<ExportRequestResult>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const idx = requestResolvers.findIndex((r) => r.timeoutId === timeoutId)
				if (idx !== -1) requestResolvers.splice(idx, 1)
				reject(new Error(`Export request was not received within ${timeoutMs}ms`))
			}, timeoutMs)

			requestResolvers.push({ resolve, reject, timeoutId })
		})
	}

	const waitForExportProgress = (
		minProgress: number,
		options: { exportId?: string; timeoutMs?: number } = {},
	): Promise<ExportCompletionResult> => {
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT

		if (currentProgress) {
			const idMatch = !options.exportId || currentProgress.id === options.exportId
			if (idMatch && currentProgress.progress >= minProgress) {
				return Promise.resolve({
					exportId: currentProgress.id,
					stage: currentProgress.stage,
					progress: currentProgress.progress,
					fileName: currentProgress.fileName,
					size: currentProgress.size,
					frameCount: currentProgress.frameCount,
					error: currentProgress.error,
				})
			}
		}

		return new Promise<ExportCompletionResult>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const idx = progressResolvers.findIndex((r) => r.timeoutId === timeoutId)
				if (idx !== -1) progressResolvers.splice(idx, 1)
				reject(new Error(
					`Export progress did not reach ${minProgress}%${options.exportId ? ` (id=${options.exportId})` : ''} within ${timeoutMs}ms. `
					+ `Current: ${currentProgress ? `${currentProgress.stage} ${currentProgress.progress}%` : 'null'}`,
				))
			}, timeoutMs)

			progressResolvers.push({
				resolve: resolve as Resolver['resolve'],
				reject,
				exportId: options.exportId,
				matches: (progress) => progress.progress >= minProgress,
				timeoutId,
			})
		})
	}

	const destroy = () => {
		unlistenProgress()
		unlistenRequest()
		for (const resolver of progressResolvers) {
			clearTimeout(resolver.timeoutId)
		}
		for (const resolver of requestResolvers) {
			clearTimeout(resolver.timeoutId)
		}
		progressResolvers.length = 0
		requestResolvers.length = 0
	}

	return {
		waitForExportStage,
		waitForExportDone,
		waitForExportRequest,
		waitForExportProgress,
		destroy,
	}
}
