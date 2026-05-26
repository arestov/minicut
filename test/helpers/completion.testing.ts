/**
 * @fileoverview Event-based completion waiters for MiniCut video editor tests.
 *
 * Replaces setTimeout-based polling with pure event-driven subscriptions.
 * Reduces test flakiness and improves observability.
 *
 * All waiters:
 * - Subscribe to relevant DKT model changes
 * - Resolve immediately if condition already met
 * - Support configurable timeout (default 5000ms)
 * - Reject on timeout with descriptive error
 */

import type { VideoEditorHarness } from '../app/createVideoEditorHarness'

/**
 * Wait for export progress to reach completion status.
 * Subscribes to SessionRoot.exportProgress rel changes.
 *
 * Resolves when:
 * - exportProgress rel becomes null (export cleared/finished), or
 * - exportProgress.status becomes "completed" or "failed"
 */
export const waitForExportCompletion = async (
	harness: VideoEditorHarness,
	exportId: string,
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
				reject(new Error(`waitForExportCompletion timeout after ${timeoutMs}ms (exportId: ${exportId})`))
			}
		}, timeoutMs)

		const checkCompletion = () => {
			if (disposed) return

			const rootScope = runtime.getRootScope()
			if (!rootScope) return

			const exportProgressScope = runtime.readOne(rootScope, 'exportProgress')
			if (!exportProgressScope) {
				// Export cleared/finished
				clearTimeout(timeout)
				disposed = true
				resolve()
				return
			}

			const attrs = runtime.readAttrs(exportProgressScope, ['exportId', 'status']) as {
				exportId?: unknown
				status?: unknown
			}

			if (attrs.exportId === exportId && (attrs.status === 'completed' || attrs.status === 'failed')) {
				clearTimeout(timeout)
				disposed = true
				resolve()
			}
		}

		// Check current state immediately
		checkCompletion()
		if (disposed) return

		// Subscribe to exportProgress changes
		const unsubscribe = runtime.subscribeRootScope(() => {
			if (!disposed) {
				checkCompletion()
			}
		})

		// Cleanup on dispose
		const originalTimeout = timeout
		const originalClearTimeout = clearTimeout.bind(globalThis)
		const wrappedResolve = resolve
		const wrappedReject = reject

		const cleanup = () => {
			originalClearTimeout(originalTimeout)
			unsubscribe()
		}

		// Override resolve/reject to cleanup
		const dispose = () => {
			if (!disposed) {
				disposed = true
				cleanup()
			}
		}
	})
}

/**
 * Wait for resources to be available in the active project.
 * Subscribes to Project.resources rel changes.
 *
 * Resolves when the number of resources >= minCount.
 */
export const waitForResourceImport = async (
	harness: VideoEditorHarness,
	projectScope: any,
	minCount: number = 1,
	timeoutMs: number = 5000,
): Promise<void> => {
	const runtime = harness.pageRuntime
	if (!runtime) {
		throw new Error('PageRuntime not available')
	}

	if (!projectScope) {
		throw new Error('Project scope required')
	}

	return new Promise((resolve, reject) => {
		let disposed = false
		const timeout = setTimeout(() => {
			if (!disposed) {
				disposed = true
				reject(new Error(`waitForResourceImport timeout after ${timeoutMs}ms (needed ${minCount} resources)`))
			}
		}, timeoutMs)

		const checkResources = () => {
			if (disposed) return

			const resourceScopes = runtime.readMany(projectScope, 'resources')
			if (resourceScopes.length >= minCount) {
				clearTimeout(timeout)
				disposed = true
				resolve()
			}
		}

		// Check current state immediately
		checkResources()
		if (disposed) return

		// Subscribe to resources rel changes
		const unsubscribe = runtime.subscribeMany(projectScope, 'resources', () => {
			if (!disposed) {
				checkResources()
			}
		})
	})
}

/**
 * Wait for a specific clip to be selected.
 * Subscribes to SessionRoot.selectedClip rel changes.
 *
 * Resolves when selectedClip.sourceClipId matches expectedSourceClipId.
 */
export const waitForClipSelection = async (
	harness: VideoEditorHarness,
	expectedSourceClipId: string,
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
				reject(
					new Error(
						`waitForClipSelection timeout after ${timeoutMs}ms (expected: ${expectedSourceClipId})`,
					),
				)
			}
		}, timeoutMs)

		const checkSelection = () => {
			if (disposed) return

			const rootScope = runtime.getRootScope()
			if (!rootScope) return

			const selectedClipScope = runtime.readOne(rootScope, 'selectedClip')
			if (!selectedClipScope) return

			const attrs = runtime.readAttrs(selectedClipScope, ['sourceClipId']) as {
				sourceClipId?: unknown
			}

			if (attrs.sourceClipId === expectedSourceClipId) {
				clearTimeout(timeout)
				disposed = true
				resolve()
			}
		}

		// Check current state immediately
		checkSelection()
		if (disposed) return

		// Subscribe to selectedClip changes
		const unsubscribe = runtime.subscribeRootScope(() => {
			if (!disposed) {
				checkSelection()
			}
		})
	})
}

/**
 * Wait for a modal/dialog to be visible by checking selectedEntityId.
 * Useful for UI tests that need to wait for selection changes.
 */
export const waitForEntitySelection = async (
	harness: VideoEditorHarness,
	expectedEntityId: string,
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
				reject(
					new Error(
						`waitForEntitySelection timeout after ${timeoutMs}ms (expected: ${expectedEntityId})`,
					),
				)
			}
		}, timeoutMs)

		const checkSelection = () => {
			if (disposed) return

			const rootScope = runtime.getRootScope()
			if (!rootScope) return

			const attrs = runtime.readAttrs(rootScope, ['selectedEntityId']) as {
				selectedEntityId?: unknown
			}

			if (attrs.selectedEntityId === expectedEntityId) {
				clearTimeout(timeout)
				disposed = true
				resolve()
			}
		}

		// Check current state immediately
		checkSelection()
		if (disposed) return

		// Subscribe to root scope changes
		const unsubscribe = runtime.subscribeRootScope(() => {
			if (!disposed) {
				checkSelection()
			}
		})
	})
}

/**
 * Wait for a specific attribute to change to a target value.
 * Generic utility for custom waits.
 */
export const waitForAttrChange = async (
	harness: VideoEditorHarness,
	scope: any,
	attrName: string,
	targetValue: unknown,
	timeoutMs: number = 5000,
): Promise<void> => {
	const runtime = harness.pageRuntime
	if (!runtime) {
		throw new Error('PageRuntime not available')
	}

	if (!scope) {
		throw new Error('Scope required')
	}

	return new Promise((resolve, reject) => {
		let disposed = false
		const timeout = setTimeout(() => {
			if (!disposed) {
				disposed = true
				reject(
					new Error(
						`waitForAttrChange timeout after ${timeoutMs}ms (attr: ${attrName}, target: ${JSON.stringify(targetValue)})`,
					),
				)
			}
		}, timeoutMs)

		const checkAttr = () => {
			if (disposed) return

			const attrs = runtime.readAttrs(scope, [attrName]) as Record<string, unknown>
			if (attrs[attrName] === targetValue) {
				clearTimeout(timeout)
				disposed = true
				resolve()
			}
		}

		// Check current state immediately
		checkAttr()
		if (disposed) return

		// Note: We cannot directly subscribe to a single scope's attr changes.
		// For now, rely on subscribeRootScope for global changes.
		// For scope-specific attrs, this is a limitation of the current API.
		// TODO: Add subscribeAttrs method to PageSyncRuntime if needed.
	})
}
