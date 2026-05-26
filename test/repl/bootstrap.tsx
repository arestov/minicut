import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createVideoEditorHarness, type VideoEditorHarness } from '../../src/video-editor/app/createVideoEditorHarness'
import { DktEditorRoot } from '../../src/video-editor/ui/dkt/DktEditorRoot'
import { MemoryWorkerAuthority } from '../../src/video-editor/worker/memoryWorker'
import { flushRuntime, getActiveProjectScope, summarizeActiveProject, summarizeGraph, summarizeRootState, waitForRuntimeReady } from './stateInspect.testing'
import { diffGraph, type GraphDiff } from './debugGraphDiff.testing'

export interface MiniCutReplHarness {
	document: Document
	harness: VideoEditorHarness
	pageRuntime: NonNullable<VideoEditorHarness['pageRuntime']>
	root: Root
	rootElement: Element
	window: Window
	createProject(title?: string): void
	destroy(): void
	dispatchProjectAction(actionName: string, payload?: unknown): void
	dispatchRootAction(actionName: string, payload?: unknown): void
	flush(ticks?: number): Promise<void>
	inspect: {
		activeProject(): ReturnType<typeof summarizeActiveProject>
		diff(beforeGraph: unknown, afterGraph: unknown): GraphDiff
		graph(): unknown
		graphSummary(): unknown
		messages(): unknown[]
		root(): ReturnType<typeof summarizeRootState>
		snapshot(): ReturnType<NonNullable<VideoEditorHarness['pageRuntime']>['getSnapshot']>
	}
	whenReady(): Promise<void>
}

export const createMiniCutReplHarness = async ({
	window,
	rootElement,
	sessionKey = 'minicut-repl',
}: {
	window: Window
	rootElement: Element
	sessionKey?: string
}): Promise<MiniCutReplHarness> => {
	const harness = createVideoEditorHarness(new MemoryWorkerAuthority())
	const runtime = harness.pageRuntime
	if (!runtime) {
		throw new Error('minicut repl requires pageRuntime')
	}

	const root = createRoot(rootElement)
	root.render(
		<DktEditorRoot runtime={runtime} bootstrapOptions={{ sessionKey }}>
			<div data-minicut-repl-root="ready" />
		</DktEditorRoot>,
	)

	const replHarness: MiniCutReplHarness = {
		document: window.document,
		harness,
		pageRuntime: runtime,
		root,
		rootElement,
		window,
		createProject(title?: string) {
			harness.actions.createProject(title)
		},
		destroy() {
			root.unmount()
			harness.destroy()
		},
		dispatchProjectAction(actionName: string, payload?: unknown) {
			const projectScope = getActiveProjectScope(runtime)
			if (!projectScope) {
				throw new Error('No active project scope')
			}
			runtime.dispatch(actionName, payload, projectScope)
		},
		dispatchRootAction(actionName: string, payload?: unknown) {
			runtime.dispatch(actionName, payload, null)
		},
		flush(ticks = 2) {
			return flushRuntime(ticks)
		},
		inspect: {
			activeProject: () => summarizeActiveProject(runtime),
			diff: (beforeGraph: unknown, afterGraph: unknown) => diffGraph(beforeGraph, afterGraph),
			graph: () => runtime.debugDumpGraph(),
			graphSummary: () => summarizeGraph(runtime.debugDumpGraph()),
			messages: () => runtime.debugMessages(),
			root: () => summarizeRootState(runtime),
			snapshot: () => runtime.getSnapshot(),
		},
		async whenReady() {
			await waitForRuntimeReady(runtime)
		},
	}

	Object.assign(window as Window & { __MINICUT_REPL__?: unknown }, {
		__MINICUT_REPL__: {
			createProject: replHarness.createProject,
			destroy: () => replHarness.destroy(),
			dispatchProjectAction: replHarness.dispatchProjectAction,
			dispatchRootAction: replHarness.dispatchRootAction,
			flush: replHarness.flush,
			inspect: replHarness.inspect,
			harness,
			pageRuntime: runtime,
			rootElement,
			sessionKey,
			window,
		},
	})

	return replHarness
}