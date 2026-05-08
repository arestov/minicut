import type { PageSyncRuntime } from '../../src/dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../src/dkt-react-sync/scope/ScopeHandle'

const waitTick = () => new Promise<void>((resolve) => {
	setTimeout(resolve, 0)
})

export const waitForRuntimeReady = async (
	runtime: PageSyncRuntime | null,
	label = 'minicut repl runtime',
) => {
	if (!runtime) {
		throw new Error(`${label} is not available`)
	}

	for (let i = 0; i < 200; i += 1) {
		const snapshot = runtime.getSnapshot()
		if (snapshot.booted && snapshot.ready && snapshot.rootNodeId) {
			await waitTick()
			await waitTick()
			return
		}

		await waitTick()
	}

	throw new Error(`${label} did not become ready in time`)
}

export const flushRuntime = async (ticks = 2) => {
	for (let i = 0; i < ticks; i += 1) {
		await waitTick()
	}
}

export const getRootScope = (runtime: PageSyncRuntime | null): ReactSyncScopeHandle | null => runtime?.getRootScope() ?? null

export const getActiveProjectScope = (runtime: PageSyncRuntime | null): ReactSyncScopeHandle | null => {
	const rootScope = getRootScope(runtime)
	if (!runtime || !rootScope) {
		return null
	}

	const activeProject = runtime.readOne(rootScope, 'activeProject')
	if (activeProject) {
		return activeProject
	}

	const pioneerScope = runtime.readOne(rootScope, 'pioneer')
	if (!pioneerScope) {
		return null
	}

	return runtime.readMany(pioneerScope, 'project')[0] ?? null
}

export const summarizeGraph = (graph: unknown) => {
	if (!graph || typeof graph !== 'object') {
		return graph
	}

	const value = graph as {
		nodes?: Array<{ nodeId?: unknown; modelName?: unknown; rels?: unknown; attrsVersion?: unknown; relsVersion?: unknown }>
		models?: Record<string, { attrs?: unknown; rels?: Array<{ name?: unknown }> }>
	}
	const summary: Record<string, unknown> = {}

	if (Array.isArray(value.nodes)) {
		summary.nodes = value.nodes.map((node) => ({
			nodeId: node.nodeId,
			modelName: node.modelName,
			relNames: node.rels && typeof node.rels === 'object' ? Object.keys(node.rels as Record<string, unknown>) : [],
			attrsVersion: node.attrsVersion,
			relsVersion: node.relsVersion,
		}))
	}

	if (value.models && typeof value.models === 'object') {
		summary.models = Object.fromEntries(
			Object.entries(value.models).map(([modelName, model]) => [
				modelName,
				{
					attrsCount: Array.isArray(model.attrs) ? model.attrs.length : undefined,
					relNames: Array.isArray(model.rels)
						? model.rels.map((rel) => rel.name).filter((name): name is string => typeof name === 'string')
						: undefined,
				},
			]),
		)
	}

	return summary
}

const summarizeClip = (runtime: PageSyncRuntime, clipScope: ReactSyncScopeHandle) => {
	const attrs = runtime.readAttrs(clipScope, [
		'sourceClipId',
		'sourceResourceId',
		'sourceResourceName',
		'name',
		'mediaKind',
		'start',
		'in',
		'duration',
	]) as Record<string, unknown>

	return {
		nodeId: clipScope._nodeId,
		sourceClipId: typeof attrs.sourceClipId === 'string' ? attrs.sourceClipId : null,
		sourceResourceId: typeof attrs.sourceResourceId === 'string' ? attrs.sourceResourceId : null,
		sourceResourceName: typeof attrs.sourceResourceName === 'string' ? attrs.sourceResourceName : null,
		name: typeof attrs.name === 'string' ? attrs.name : 'Clip',
		mediaKind: typeof attrs.mediaKind === 'string' ? attrs.mediaKind : null,
		start: typeof attrs.start === 'number' ? attrs.start : null,
		in: typeof attrs.in === 'number' ? attrs.in : null,
		duration: typeof attrs.duration === 'number' ? attrs.duration : null,
	}
}

const summarizeTrack = (runtime: PageSyncRuntime, trackScope: ReactSyncScopeHandle) => {
	const attrs = runtime.readAttrs(trackScope, ['sourceTrackId', 'name', 'kind', 'muted', 'locked', 'height']) as Record<string, unknown>
	const clips = runtime.readMany(trackScope, 'clips').map((clipScope) => summarizeClip(runtime, clipScope))

	return {
		nodeId: trackScope._nodeId,
		sourceTrackId: typeof attrs.sourceTrackId === 'string' ? attrs.sourceTrackId : null,
		name: typeof attrs.name === 'string' ? attrs.name : 'Track',
		kind: typeof attrs.kind === 'string' ? attrs.kind : null,
		muted: attrs.muted === true,
		locked: attrs.locked === true,
		height: typeof attrs.height === 'number' ? attrs.height : null,
		clips,
	}
}

const summarizeResource = (runtime: PageSyncRuntime, resourceScope: ReactSyncScopeHandle) => {
	const attrs = runtime.readAttrs(resourceScope, ['sourceResourceId', 'name', 'kind', 'duration', 'status', 'size']) as Record<string, unknown>

	return {
		nodeId: resourceScope._nodeId,
		sourceResourceId: typeof attrs.sourceResourceId === 'string' ? attrs.sourceResourceId : null,
		name: typeof attrs.name === 'string' ? attrs.name : 'Resource',
		kind: typeof attrs.kind === 'string' ? attrs.kind : null,
		duration: typeof attrs.duration === 'number' ? attrs.duration : null,
		status: typeof attrs.status === 'string' ? attrs.status : null,
		size: typeof attrs.size === 'number' ? attrs.size : null,
	}
}

export const summarizeRootState = (runtime: PageSyncRuntime | null) => {
	const rootScope = getRootScope(runtime)
	if (!runtime || !rootScope) {
		return null
	}

	const attrs = runtime.readAttrs(rootScope, ['selectedEntityId', 'selectedClipSummary']) as Record<string, unknown>
	const selectedClip = runtime.readOne(rootScope, 'selectedClip')

	return {
		nodeId: rootScope._nodeId,
		selectedEntityId: typeof attrs.selectedEntityId === 'string' ? attrs.selectedEntityId : null,
		selectedClipSummary: attrs.selectedClipSummary ?? null,
		selectedClip: selectedClip ? summarizeClip(runtime, selectedClip) : null,
	}
}

export const summarizeActiveProject = (runtime: PageSyncRuntime | null) => {
	const projectScope = getActiveProjectScope(runtime)
	if (!runtime || !projectScope) {
		return null
	}

	const attrs = runtime.readAttrs(projectScope, ['sourceProjectId', 'title', 'duration', 'timelineDuration']) as Record<string, unknown>
	const tracks = runtime.readMany(projectScope, 'tracks').map((trackScope) => summarizeTrack(runtime, trackScope))
	const resources = runtime.readMany(projectScope, 'resources').map((resourceScope) => summarizeResource(runtime, resourceScope))
	const primaryVideoTrack = runtime.readOne(projectScope, 'primaryVideoTrack')
	const primaryAudioTrack = runtime.readOne(projectScope, 'primaryAudioTrack')

	return {
		nodeId: projectScope._nodeId,
		sourceProjectId: typeof attrs.sourceProjectId === 'string' ? attrs.sourceProjectId : null,
		title: typeof attrs.title === 'string' ? attrs.title : 'Project',
		duration: typeof attrs.duration === 'number' ? attrs.duration : null,
		timelineDuration: typeof attrs.timelineDuration === 'number' ? attrs.timelineDuration : null,
		primaryTracks: {
			video: primaryVideoTrack ? summarizeTrack(runtime, primaryVideoTrack) : null,
			audio: primaryAudioTrack ? summarizeTrack(runtime, primaryAudioTrack) : null,
		},
		tracks,
		resources,
	}
}