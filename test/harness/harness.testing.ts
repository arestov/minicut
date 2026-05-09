/**
 * @fileoverview Testing harness helpers for MiniCut video editor.
 *
 * This module provides low-level testing utilities for examining and manipulating
 * harness state during tests. Designed for test-only usage, not production.
 *
 * Event-driven API:
 * - waitForProjectCreation: subscribe to activeProject rel change
 * - dumpGraph: debug utility to inspect model tree
 * - findClipBySourceId: manual traversal for test assertions
 */

import type { VideoEditorHarness } from '../app/createVideoEditorHarness'
import type { PageSyncRuntime } from '../dkt-react-sync/PageSyncRuntime'

/**
 * Wait for activeProject to be available with optional timeout.
 * Uses pure event-driven subscription, no polling.
 *
 * Resolves when activeProject rel is non-null, rejects on timeout.
 */
export const waitForProjectCreation = async (
	harness: VideoEditorHarness,
	timeoutMs: number = 5000,
): Promise<void> => {
	const runtime = harness.pageRuntime
	if (!runtime) {
		throw new Error('PageRuntime not available')
	}

	return new Promise((resolve, reject) => {
		let disposed = false
		const timeout = setTimeout(() => {
			if (!disposed) {
				disposed = true
				reject(new Error(`waitForProjectCreation timeout after ${timeoutMs}ms`))
			}
		}, timeoutMs)

		// Check current state immediately
		const rootScope = runtime.getRootScope()
		const activeProjectScope = rootScope ? runtime.readOne(rootScope, 'activeProject') : null
		if (activeProjectScope) {
			clearTimeout(timeout)
			disposed = true
			return resolve()
		}

		// Subscribe to future changes
		const unsubscribe = runtime.subscribeRootScope(() => {
			if (disposed) return
			const latestRoot = runtime.getRootScope()
			const latestProject = latestRoot ? runtime.readOne(latestRoot, 'activeProject') : null
			if (latestProject) {
				clearTimeout(timeout)
				disposed = true
				unsubscribe()
				resolve()
			}
		})
	})
}

/**
 * Get the current project scope from the harness, or null if not available.
 */
export const getActiveProject = (harness: VideoEditorHarness) => {
	const runtime = harness.pageRuntime
	if (!runtime) {
		return null
	}

	const rootScope = runtime.getRootScope()
	if (!rootScope) {
		return null
	}

	return runtime.readOne(rootScope, 'activeProject') ?? null
}

/**
 * Debug utility: dump the entire DKT model graph as a readable object.
 * For test assertions and inspection only.
 */
export const dumpGraph = (harness: VideoEditorHarness) => {
	return harness.pageRuntime?.debugDumpGraph?.() ?? null
}

/**
 * Find a clip by sourceClipId via manual graph traversal.
 * This is for testing only; production code should use pure rel queries.
 *
 * Returns { trackScope, clipScope } or null if not found.
 */
export const findClipBySourceId = (
	harness: VideoEditorHarness,
	sourceClipId: string,
): { trackScope: any; clipScope: any } | null => {
	const runtime = harness.pageRuntime
	if (!runtime) {
		return null
	}

	const projectScope = getActiveProject(harness)
	if (!projectScope) {
		return null
	}

	const trackScopes = runtime.readMany(projectScope, 'tracks')
	for (const trackScope of trackScopes) {
		const clipScopes = runtime.readMany(trackScope, 'clips')
		for (const clipScope of clipScopes) {
			const attrs = runtime.readAttrs(clipScope, ['sourceClipId']) as { sourceClipId?: unknown }
			if (attrs.sourceClipId === sourceClipId) {
				return { trackScope, clipScope }
			}
		}
	}

	return null
}

/**
 * Get a summary of the current project state for test assertions.
 * Returns structured data about tracks, clips, and resources.
 */
export const getProjectSummary = (
	harness: VideoEditorHarness,
): {
	projectId: string | null
	trackCount: number
	clipCount: number
	resourceCount: number
	tracks: Array<{ name: string; clipCount: number }>
} | null => {
	const runtime = harness.pageRuntime
	if (!runtime) {
		return null
	}

	const projectScope = getActiveProject(harness)
	if (!projectScope) {
		return null
	}

	const projectAttrs = runtime.readAttrs(projectScope, ['sourceProjectId']) as {
		sourceProjectId?: unknown
	}

	const trackScopes = runtime.readMany(projectScope, 'tracks')
	const tracks = trackScopes.map((trackScope) => {
		const trackAttrs = runtime.readAttrs(trackScope, ['name']) as { name?: unknown }
		const clipCount = runtime.readMany(trackScope, 'clips').length
		return {
			name: typeof trackAttrs.name === 'string' ? trackAttrs.name : 'Track',
			clipCount,
		}
	})

	const clipCount = tracks.reduce((sum, track) => sum + track.clipCount, 0)
	const resourceScopes = runtime.readMany(projectScope, 'resources')
	const resourceCount = resourceScopes.length

	return {
		projectId: typeof projectAttrs.sourceProjectId === 'string' ? projectAttrs.sourceProjectId : null,
		trackCount: trackScopes.length,
		clipCount,
		resourceCount,
		tracks,
	}
}
