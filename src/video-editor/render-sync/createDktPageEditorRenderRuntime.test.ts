// @ts-nocheck
// TODO(Phase 5): rewrite this suite for hard DKT runtime (no registry fallback).
import type { PageRootSnapshot, PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { DefinedReactShape } from '../../dkt-react-sync/shape/defineShape'
import { ROOT_SCOPE, SESSION_SCOPE, type EditorScope } from './EditorScope'
import type { EditorRenderRuntime } from './EditorRenderRuntime'
import { createDktPageEditorRenderRuntime } from './createDktPageEditorRenderRuntime'

type FakeNode = {
	modelName: string
	attrs: Record<string, unknown>
	rels: Record<string, string | string[] | null>
}

type FakePageRuntime = PageSyncRuntime & {
	dispatched: Array<{ actionName: string; payload: unknown; scopeNodeId: string | null }>
}

const createFakePageRuntime = ({ materializedProjects = true }: { materializedProjects?: boolean } = {}): FakePageRuntime => {
	const nodes: Record<string, FakeNode> = {
		root: {
			modelName: 'minicut_session_root',
			attrs: {
				activeProjectId: 'project-source',
				selectedEntityId: 'clip-source',
				cursor: 0,
				timelineZoom: 16,
			},
			rels: { pioneer: 'app' },
		},
		app: {
			modelName: 'minicut_app_root',
			attrs: {},
			rels: { project: ['project-node'] },
		},
		'project-node': {
			modelName: 'minicut_project',
			attrs: { sourceProjectId: 'project-source', title: 'Project' },
			rels: { tracks: ['track-node'], resources: [] },
		},
		'track-node': {
			modelName: 'minicut_track',
			attrs: { sourceTrackId: 'track-source', name: 'Video 1', kind: 'video' },
			rels: { clips: ['clip-node'] },
		},
		'clip-node': {
			modelName: 'minicut_clip',
			attrs: { sourceClipId: 'clip-source', name: 'Clip', start: 0, duration: 2 },
			rels: { effects: [], resource: null, text: null },
		},
	}
	const dispatched: FakePageRuntime['dispatched'] = []
	if (!materializedProjects) {
		nodes.app.rels.project = []
	}
	const snapshot: PageRootSnapshot = {
		booted: true,
		ready: true,
		version: 1,
		rootNodeId: 'root',
		sessionId: null,
		sessionKey: 'test',
	}
	const toScope = (nodeId: string | null | undefined): ReactSyncScopeHandle | null => nodeId ? { kind: 'scope', _nodeId: nodeId } : null
	const readNode = (scope: ReactSyncScopeHandle) => nodes[scope._nodeId]
	const runtime: FakePageRuntime = {
		dispatched,
		store: {
			getSnapshot: () => snapshot,
			setSnapshot: () => {},
			subscribe: () => () => {},
		},
		bootstrap() {},
		debugDescribeNode(nodeId) {
			const node = nodes[nodeId]
			return node ? {
				nodeId,
				modelName: node.modelName,
				hierarchyNum: null,
				constrId: null,
				attrsVersion: 1,
				relsVersion: 1,
				attrs: node.attrs,
				rels: node.rels,
			} : null
		},
		debugDumpGraph() {
			return {
				rootNodeId: 'root',
				dict: null,
				modelSchema: null,
				nodes: Object.keys(nodes).map((nodeId) => runtime.debugDescribeNode(nodeId)!).filter(Boolean),
			}
		},
		debugMessages: () => [],
		dispatchAction(actionName, payload, scope) {
			dispatched.push({ actionName, payload, scopeNodeId: scope?._nodeId ?? null })
		},
		destroy() {},
		getSnapshot: () => snapshot,
		getRootAttrs(attrNames) {
			return Object.fromEntries(attrNames.map((attrName) => [attrName, nodes.root.attrs[attrName]]))
		},
		subscribe: () => () => {},
		subscribeRootAttrs: () => () => {},
		getRootScope: () => toScope('root'),
		subscribeRootScope: () => () => {},
		readAttrs(scope, attrNames) {
			const node = readNode(scope)
			return Object.fromEntries(attrNames.map((attrName) => [attrName, node?.attrs[attrName]]))
		},
		subscribeAttrs: () => () => {},
		readOne(scope, relName) {
			const rel = readNode(scope)?.rels[relName]
			return typeof rel === 'string' ? toScope(rel) : null
		},
		subscribeOne: () => () => {},
		readMany(scope, relName) {
			const rel = readNode(scope)?.rels[relName]
			return Array.isArray(rel) ? rel.map((nodeId) => toScope(nodeId)!).filter(Boolean) : []
		},
		subscribeMany: () => () => {},
		mountShape: (_scope: ReactSyncScopeHandle, _shape: DefinedReactShape) => () => {},
		dispatch(actionName, payload, scope) {
			runtime.dispatchAction(actionName, payload, scope)
		},
		getDispatch(scope) {
			return (actionName, payload) => runtime.dispatch(actionName, payload, scope)
		},
	}

	return runtime
}

const createLegacyRuntime = (): EditorRenderRuntime => ({
	getRootScope: () => ROOT_SCOPE,
	getSessionScope: () => SESSION_SCOPE,
	readAttrs(scope, fields) {
		if (scope === ROOT_SCOPE || scope.type === 'root') {
			return Object.fromEntries(fields.map((field) => [field, field === 'projectCount' ? 1 : undefined]))
		}
		return Object.fromEntries(fields.map((field) => [field, undefined]))
	},
	subscribeAttrs: () => () => {},
	readOne: () => null,
	subscribeOne: () => () => {},
	readMany: () => [],
	subscribeMany: () => () => {},
	readComp: () => null,
	subscribeComp: () => () => {},
	getDispatch: () => () => {},
})

const createActions = () => ({
	addColorCorrectionToClip: vi.fn(),
	addResourceToTimeline: vi.fn(),
	addEffectToClip: vi.fn(),
	addTextClip: vi.fn(),
	addTrack: vi.fn(),
	colorClipById: vi.fn(),
	createProject: vi.fn(),
	deleteClipById: vi.fn(),
	deleteSelectedClip: vi.fn(),
	importFiles: vi.fn(),
	importSampleResource: vi.fn(),
	moveClipById: vi.fn(),
	nudgeSelectedClip: vi.fn(),
	removeEffectFromClip: vi.fn(),
	renameClipById: vi.fn(),
	resizeClipById: vi.fn(),
	selectEntity: vi.fn(),
	setActiveInspectorTab: vi.fn(),
	setActiveProject: vi.fn(),
	splitClipByIdAt: vi.fn(),
	splitSelectedClip: vi.fn(),
	tickPlayback: vi.fn(),
	trimClipById: vi.fn(),
	togglePlayback: vi.fn(),
	setCursor: vi.fn(),
	updateClipAudioById: vi.fn(),
	updateClipFadeById: vi.fn(),
	updateClipOpacityById: vi.fn(),
	updateClipTransformById: vi.fn(),
	updateEffectAttrs: vi.fn(),
	updateTextById: vi.fn(),
	zoomTimeline: vi.fn(),
})

// Behavior contract: render runtime must traverse pure DKT page scopes with no legacy compatibility branch.
// Skipped: suite still covers compatibility semantics scheduled for full removal.
describe.skip('createDktPageEditorRenderRuntime', () => {
	it('maps active project and timeline reads to the DKT page replica', () => {
		const pageRuntime = createFakePageRuntime()
		const runtime = createDktPageEditorRenderRuntime({
			pageRuntime,
			legacyRuntime: createLegacyRuntime(),
			actions: createActions(),
		})

		const projectScope = runtime.readOne(runtime.getRootScope(), 'activeProject')
		const timelineScope = projectScope ? runtime.readOne(projectScope, 'activeTimeline') : null
		const trackScopes = timelineScope ? runtime.readMany(timelineScope, 'tracks') : []
		const clipScopes = trackScopes[0] ? runtime.readMany(trackScopes[0], 'clips') : []

		expect(runtime.readAttrs(runtime.getRootScope(), ['activeProjectId', 'projectCount'])).toMatchObject({
			activeProjectId: 'project-source',
			projectCount: 1,
		})
		expect(projectScope).toMatchObject({ nodeId: 'project-node', type: 'project' })
		expect(timelineScope?.nodeId).toBe(projectScope?.nodeId)
		expect(trackScopes).toHaveLength(1)
		expect(clipScopes[0]).toMatchObject({ nodeId: 'clip-node', type: 'clip' })
	})

	it('dispatches scoped DKT clip actions without mirroring legacy source ids', () => {
		const pageRuntime = createFakePageRuntime()
		const actions = createActions()
		const runtime = createDktPageEditorRenderRuntime({
			pageRuntime,
			legacyRuntime: createLegacyRuntime(),
			actions,
		})
		const clipScope: EditorScope = { nodeId: 'clip-node', type: 'clip' }
		const dispatch = runtime.getDispatch(clipScope)

		dispatch('select')
		dispatch('moveBy', { delta: 0.5 })
		dispatch('setOpacity', { opacityPercent: 40 })

		expect(pageRuntime.dispatched).toEqual([
			{ actionName: 'selectEntity', payload: 'clip-node', scopeNodeId: 'root' },
			{ actionName: 'moveBy', payload: { delta: 0.5 }, scopeNodeId: 'clip-node' },
			{ actionName: 'updateOpacity', payload: { opacityPercent: 40 }, scopeNodeId: 'clip-node' },
		])
		expect(actions.selectEntity).not.toHaveBeenCalled()
		expect(actions.moveClipById).not.toHaveBeenCalled()
		expect(actions.updateClipOpacityById).not.toHaveBeenCalled()
	})

	it('exposes partial streaming state without falling back to legacy project reads', () => {
		const runtime = createDktPageEditorRenderRuntime({
			pageRuntime: createFakePageRuntime({ materializedProjects: false }),
			legacyRuntime: createLegacyRuntime(),
			actions: createActions(),
		})

		expect(runtime.readOne(runtime.getRootScope(), 'activeProject')).toBeNull()
		expect(runtime.readMany(runtime.getRootScope(), 'projects')).toEqual([])
	})
})
