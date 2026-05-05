import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncDebugGraph, ReactSyncDebugNode } from '../../dkt-react-sync/receiver/ReactSyncReceiver'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EntityType } from '../domain/types'
import { ROOT_SCOPE, SESSION_SCOPE, type EditorScope } from './EditorScope'
import type { EditorRenderRuntime, EditorScopedDispatch } from './EditorRenderRuntime'

type HarnessActions = {
	addColorCorrectionToClip(clipId: string): void
	addResourceToTimeline(resourceId: string): void
	addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void
	addTextClip(content?: string): void
	addTrack(kind: 'video' | 'audio'): void
	colorClipById(clipId: string, color: string): void
	createProject(title?: string): void
	deleteClipById(clipId: string): void
	deleteSelectedClip(): void
	importFiles(files: FileList | File[]): void
	importSampleResource(): void
	moveClipById(clipId: string, delta: number): void
	nudgeSelectedClip(delta: number): void
	removeEffectFromClip(clipId: string, effectId: string): void
	renameClipById(clipId: string, name: string): void
	resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	selectEntity(entityId: string | null): void
	setActiveInspectorTab(tab: 'edit' | 'color' | 'audio' | 'export'): void
	setActiveProject(projectId: string): void
	splitClipByIdAt(clipId: string, time: number): void
	splitSelectedClip(): void
	tickPlayback(deltaSeconds: number): void
	trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	togglePlayback(): void
	setCursor(value: number): void
	updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void
	updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void
	updateClipOpacityById(clipId: string, opacityPercent: number): void
	updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void
	updateEffectAttrs(effectId: string, attrs: Record<string, unknown>): void
	updateTextById(textId: string, attrs: Record<string, unknown>): void
	zoomTimeline(delta: number): void
}

export interface CreateDktPageEditorRenderRuntimeOptions {
	pageRuntime: PageSyncRuntime | null
	legacyRuntime: EditorRenderRuntime
	actions: HarnessActions
}

const MODEL_TYPE_BY_NAME: Record<string, EntityType | 'session' | 'root'> = {
	minicut_session_root: 'session',
	minicut_app_root: 'root',
	minicut_project: 'project',
	minicut_track: 'track',
	minicut_resource: 'resource',
	minicut_clip: 'clip',
	minicut_text: 'text',
	minicut_effect: 'effect',
}

const SOURCE_ATTR_BY_TYPE: Partial<Record<EntityType, string>> = {
	project: 'sourceProjectId',
	track: 'sourceTrackId',
	resource: 'sourceResourceId',
	clip: 'sourceClipId',
	text: 'sourceTextId',
	effect: 'sourceEffectId',
}

const TYPE_BY_SOURCE_ATTR: Record<string, EntityType> = Object.fromEntries(
	Object.entries(SOURCE_ATTR_BY_TYPE).map(([type, attr]) => [attr, type]),
) as Record<string, EntityType>

const TYPE_BY_REL: Partial<Record<string, EntityType>> = {
	activeProject: 'project',
	project: 'project',
	projects: 'project',
	tracks: 'track',
	track: 'track',
	resources: 'resource',
	resource: 'resource',
	clips: 'clip',
	clip: 'clip',
	text: 'text',
	effects: 'effect',
	effect: 'effect',
}

const EMPTY_LIST = Object.freeze([]) as readonly ReactSyncScopeHandle[]
const EMPTY_CLEANUP = () => {}

const toDktScope = (scope: EditorScope | null): ReactSyncScopeHandle | null => {
	if (!scope || scope === ROOT_SCOPE || scope === SESSION_SCOPE || scope.nodeId.startsWith('$')) {
		return null
	}
	if (!(scope.type in SOURCE_ATTR_BY_TYPE)) {
		return null
	}

	return { kind: 'scope', _nodeId: scope.nodeId }
}

const toEditorScope = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle | null, fallbackType: EditorScope['type'] = 'root'): EditorScope | null => {
	if (!scope) {
		return null
	}

	const modelName = runtime.debugDescribeNode(scope._nodeId)?.modelName ?? null
	return {
		nodeId: scope._nodeId,
		type: modelName ? MODEL_TYPE_BY_NAME[modelName] ?? fallbackType : fallbackType,
	}
}

const combineCleanups = (cleanups: Array<() => void>): (() => void) => {
	let active = true
	return () => {
		if (!active) {
			return
		}
		active = false
		for (let index = cleanups.length - 1; index >= 0; index -= 1) {
			cleanups[index]()
		}
	}
}

const readGraph = (runtime: PageSyncRuntime): ReactSyncDebugGraph => runtime.debugDumpGraph() as ReactSyncDebugGraph

const getNodeType = (node: ReactSyncDebugNode): EditorScope['type'] => node.modelName ? MODEL_TYPE_BY_NAME[node.modelName] ?? 'root' : 'root'

const findSourceIdForDktScope = (runtime: PageSyncRuntime, scope: EditorScope | null): string | null => {
	if (!scope || scope === ROOT_SCOPE || scope === SESSION_SCOPE || scope.nodeId.startsWith('$')) {
		return null
	}

	const node = runtime.debugDescribeNode(scope.nodeId)
	if (!node) {
		return null
	}

	const sourceAttr = SOURCE_ATTR_BY_TYPE[getNodeType(node) as EntityType]
	const sourceId = sourceAttr ? node.attrs[sourceAttr] : null
	return typeof sourceId === 'string' ? sourceId : null
}

const findDktScopeBySourceId = (runtime: PageSyncRuntime, sourceId: string | null | undefined): EditorScope | null => {
	if (!sourceId) {
		return null
	}

	const match = readGraph(runtime).nodes.find((node) => (
		Object.entries(TYPE_BY_SOURCE_ATTR).some(([attrName, type]) => node.attrs[attrName] === sourceId && getNodeType(node) === type)
	))

	return match ? { nodeId: match.nodeId, type: getNodeType(match) } : null
}

const getPageRoot = (runtime: PageSyncRuntime | null): ReactSyncScopeHandle | null => runtime?.getRootScope() ?? null

const getPioneerScope = (runtime: PageSyncRuntime): ReactSyncScopeHandle | null => {
	const root = getPageRoot(runtime)
	return root ? runtime.readOne(root, 'pioneer') : null
}

const readProjectScopes = (runtime: PageSyncRuntime): readonly ReactSyncScopeHandle[] => {
	const pioneer = getPioneerScope(runtime)
	return pioneer ? runtime.readMany(pioneer, 'project') : EMPTY_LIST
}

const readActiveProjectScope = (runtime: PageSyncRuntime, legacyRuntime: EditorRenderRuntime): EditorScope | null => {
	const activeProjectId = runtime.getRootAttrs(['activeProjectId']).activeProjectId
		?? legacyRuntime.readAttrs(ROOT_SCOPE, ['activeProjectId']).activeProjectId
	const projects = readProjectScopes(runtime)
	const matched = typeof activeProjectId === 'string'
		? projects.find((projectScope) => runtime.readAttrs(projectScope, ['sourceProjectId']).sourceProjectId === activeProjectId)
		: null

	return toEditorScope(runtime, matched ?? projects[0] ?? null, 'project')
}

const subscribeActiveProject = (runtime: PageSyncRuntime, listener: () => void): (() => void) => {
	let stopProjectList: (() => void) | null = null
	const bindProjectList = () => {
		stopProjectList?.()
		const pioneer = getPioneerScope(runtime)
		stopProjectList = pioneer ? runtime.subscribeMany(pioneer, 'project', listener) : null
	}
	const rebindAndNotify = () => {
		bindProjectList()
		listener()
	}

	bindProjectList()

	return combineCleanups([
		runtime.subscribeRootScope(rebindAndNotify),
		(() => {
			const root = getPageRoot(runtime)
			return root ? runtime.subscribeOne(root, 'pioneer', rebindAndNotify) : EMPTY_CLEANUP
		})(),
		runtime.subscribeRootAttrs(['activeProjectId'], listener),
		() => stopProjectList?.(),
	])
}

const normalizeRootAttrs = (
	runtime: PageSyncRuntime,
	legacyRuntime: EditorRenderRuntime,
	fields: readonly string[],
): Record<string, unknown> => {
	const rootAttrs = runtime.getRootAttrs(fields)
	const legacyAttrs = legacyRuntime.readAttrs(ROOT_SCOPE, fields)
	const result: Record<string, unknown> = {}

	for (const field of fields) {
		if (field === 'projectCount') {
			result[field] = readProjectScopes(runtime).length || legacyAttrs[field]
			continue
		}

		result[field] = rootAttrs[field] ?? legacyAttrs[field]
	}

	return result
}

const normalizeSessionAttrs = (
	runtime: PageSyncRuntime,
	legacyRuntime: EditorRenderRuntime,
	fields: readonly string[],
): Record<string, unknown> => {
	const rootAttrs = runtime.getRootAttrs(fields)
	const legacyAttrs = legacyRuntime.readAttrs(SESSION_SCOPE, fields)
	const result: Record<string, unknown> = {}

	for (const field of fields) {
		if (field === 'selectedEntityId') {
			const selectedSourceId = rootAttrs.selectedEntityId ?? legacyAttrs.selectedEntityId
			const selectedScope = typeof selectedSourceId === 'string' ? findDktScopeBySourceId(runtime, selectedSourceId) : null
			result[field] = selectedScope?.nodeId ?? selectedSourceId ?? null
			continue
		}

		result[field] = rootAttrs[field] ?? legacyAttrs[field]
	}

	return result
}

const getNumberPayload = (payload: unknown, key: string): number | null => {
	const value = (payload as Record<string, unknown> | null)?.[key]
	return typeof value === 'number' ? value : null
}

const getStringPayload = (payload: unknown, key: string): string | null => {
	const value = (payload as Record<string, unknown> | null)?.[key]
	return typeof value === 'string' ? value : null
}

const dispatchSessionMirror = (
	runtime: PageSyncRuntime | null,
	actions: HarnessActions,
	actionName: EditorActionName,
	payload: unknown,
): boolean => {
	const rootScope = getPageRoot(runtime)
	if (actionName === 'setCursor') {
		const value = getNumberPayload(payload, 'value')
		if (value !== null) {
			runtime?.dispatch('setCursor', value, rootScope)
			actions.setCursor(value)
		}
		return true
	}
	if (actionName === 'zoomTimeline') {
		const delta = getNumberPayload(payload, 'delta')
		if (delta !== null) {
			runtime?.dispatch('zoomTimeline', delta, rootScope)
			actions.zoomTimeline(delta)
		}
		return true
	}
	if (actionName === 'togglePlayback') {
		runtime?.dispatch('togglePlayback', undefined, rootScope)
		actions.togglePlayback()
		return true
	}
	if (actionName === 'setActiveProject') {
		const projectId = typeof payload === 'string' ? payload : getStringPayload(payload, 'projectId')
		if (projectId) {
			runtime?.dispatch('setActiveProject', projectId, rootScope)
			actions.setActiveProject(projectId)
		}
		return true
	}
	if (actionName === 'setActiveInspectorTab') {
		const tab = (payload as Record<string, unknown> | null)?.tab
		if (tab === 'edit' || tab === 'color' || tab === 'audio' || tab === 'export') {
			actions.setActiveInspectorTab(tab)
		}
		return true
	}
	if (actionName === 'splitSelectedClip') {
		actions.splitSelectedClip()
		return true
	}
	if (actionName === 'nudgeSelectedClip') {
		const delta = getNumberPayload(payload, 'delta')
		if (delta !== null) {
			actions.nudgeSelectedClip(delta)
		}
		return true
	}
	if (actionName === 'deleteSelectedClip') {
		actions.deleteSelectedClip()
		return true
	}

	return false
}

const createScopedDispatch = (
	runtime: PageSyncRuntime | null,
	legacyRuntime: EditorRenderRuntime,
	actions: HarnessActions,
	scope: EditorScope | null,
): EditorScopedDispatch => ((actionName, payload) => {
	if (!scope || scope === ROOT_SCOPE || scope === SESSION_SCOPE || scope.nodeId.startsWith('$')) {
		if (dispatchSessionMirror(runtime, actions, actionName, payload)) {
			return
		}
		legacyRuntime.getDispatch(scope)(actionName, payload as never)
		return
	}

	const sourceId = runtime ? findSourceIdForDktScope(runtime, scope) : null
	const dktScope = toDktScope(scope)

	if (scope.type === 'clip' && sourceId) {
		if (actionName === 'select') {
			runtime?.dispatch('selectEntity', sourceId, getPageRoot(runtime))
			actions.selectEntity(sourceId)
			return
		}
		if (actionName === 'moveBy') {
			const delta = getNumberPayload(payload, 'delta')
			if (delta !== null) {
				runtime?.dispatch('moveBy', { delta }, dktScope)
				actions.moveClipById(sourceId, delta)
			}
			return
		}
		if (actionName === 'resize' || actionName === 'trim') {
			const edge = (payload as Record<string, unknown> | null)?.edge
			const delta = getNumberPayload(payload, 'delta')
			if ((edge === 'start' || edge === 'end') && delta !== null) {
				runtime?.dispatch(actionName, { edge, delta }, dktScope)
				if (actionName === 'resize') {
					actions.resizeClipById(sourceId, edge, delta)
				} else {
					actions.trimClipById(sourceId, edge, delta)
				}
			}
			return
		}
		if (actionName === 'splitAt') {
			const time = getNumberPayload(payload, 'time')
			if (time !== null) {
				runtime?.dispatch('splitAt', { time }, dktScope)
				actions.splitClipByIdAt(sourceId, time)
			}
			return
		}
		if (actionName === 'rename') {
			const name = getStringPayload(payload, 'name')
			if (name !== null) {
				runtime?.dispatch('rename', { name }, dktScope)
				actions.renameClipById(sourceId, name)
			}
			return
		}
		if (actionName === 'color') {
			const color = getStringPayload(payload, 'color')
			if (color !== null) {
				runtime?.dispatch('color', { color }, dktScope)
				actions.colorClipById(sourceId, color)
			}
			return
		}
		if (actionName === 'setOpacity') {
			const opacityPercent = getNumberPayload(payload, 'opacityPercent')
			if (opacityPercent !== null) {
				runtime?.dispatch('updateOpacity', { opacityPercent }, dktScope)
				actions.updateClipOpacityById(sourceId, opacityPercent)
			}
			return
		}
		if (actionName === 'setFade') {
			const edge = (payload as Record<string, unknown> | null)?.edge
			const delta = getNumberPayload(payload, 'delta')
			if ((edge === 'in' || edge === 'out') && delta !== null) {
				runtime?.dispatch('setFade', { edge, delta }, dktScope)
				actions.updateClipFadeById(sourceId, edge, delta)
			}
			return
		}
		if (actionName === 'setTransform') {
			runtime?.dispatch('setTransform', payload, dktScope)
			actions.updateClipTransformById(sourceId, payload as Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>)
			return
		}
		if (actionName === 'setAudio') {
			runtime?.dispatch('setAudio', payload, dktScope)
			actions.updateClipAudioById(sourceId, payload as Partial<Record<'gain' | 'pan', number>>)
			return
		}
		if (actionName === 'addEffect') {
			const kind = (payload as Record<string, unknown> | null)?.kind
			if (kind === 'blur' || kind === 'sharpen' || kind === 'tint') {
				actions.addEffectToClip(sourceId, kind)
			}
			return
		}
		if (actionName === 'addColorCorrection') {
			actions.addColorCorrectionToClip(sourceId)
			return
		}
		if (actionName === 'removeEffect') {
			const effectId = getStringPayload(payload, 'effectId')
			if (effectId !== null) {
				const sourceEffectScope = runtime ? findDktScopeBySourceId(runtime, effectId) : null
				actions.removeEffectFromClip(sourceId, sourceEffectScope ? findSourceIdForDktScope(runtime!, sourceEffectScope) ?? effectId : effectId)
			}
			return
		}
		if (actionName === 'deleteSelectedClip' || actionName === 'deleteClip') {
			actions.deleteClipById(sourceId)
			return
		}
	}

	if (scope.type === 'resource' && sourceId && actionName === 'addResourceToTimeline') {
		actions.addResourceToTimeline(sourceId)
		return
	}

	if (scope.type === 'text' && sourceId && actionName === 'updateText') {
		runtime?.dispatch('setTextContent', payload, dktScope)
		actions.updateTextById(sourceId, payload as Record<string, unknown>)
		return
	}

	if (scope.type === 'effect' && sourceId && actionName === 'updateEffect') {
		runtime?.dispatch('setEffectParams', payload, dktScope)
		actions.updateEffectAttrs(sourceId, payload as Record<string, unknown>)
		return
	}

	legacyRuntime.getDispatch(scope)(actionName, payload as never)
}) as EditorScopedDispatch

export const createDktPageEditorRenderRuntime = ({
	pageRuntime,
	legacyRuntime,
	actions,
}: CreateDktPageEditorRenderRuntimeOptions): EditorRenderRuntime => ({
	getRootScope: () => ROOT_SCOPE,
	getSessionScope: () => SESSION_SCOPE,
	readAttrs(scope, fields) {
		if (!pageRuntime?.getRootScope()) {
			return legacyRuntime.readAttrs(scope, fields)
		}
		if (scope === ROOT_SCOPE || scope.type === 'root') {
			return normalizeRootAttrs(pageRuntime, legacyRuntime, fields)
		}
		if (scope === SESSION_SCOPE || scope.type === 'session') {
			return normalizeSessionAttrs(pageRuntime, legacyRuntime, fields)
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.readAttrs(dktScope, fields) : legacyRuntime.readAttrs(scope, fields)
	},
	subscribeAttrs(scope, fields, listener) {
		if (!pageRuntime?.getRootScope()) {
			return legacyRuntime.subscribeAttrs(scope, fields, listener)
		}
		if (scope === ROOT_SCOPE || scope.type === 'root') {
			return combineCleanups([
				pageRuntime.subscribeRootAttrs(fields.filter((field) => field !== 'projectCount'), listener),
				fields.includes('projectCount') ? subscribeActiveProject(pageRuntime, listener) : EMPTY_CLEANUP,
				legacyRuntime.subscribeAttrs(ROOT_SCOPE, fields, listener),
			])
		}
		if (scope === SESSION_SCOPE || scope.type === 'session') {
			return combineCleanups([
				pageRuntime.subscribeRootAttrs(fields, listener),
				legacyRuntime.subscribeAttrs(SESSION_SCOPE, fields, listener),
			])
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.subscribeAttrs(dktScope, fields, listener) : legacyRuntime.subscribeAttrs(scope, fields, listener)
	},
	readOne(scope, relName) {
		if (!pageRuntime?.getRootScope()) {
			return legacyRuntime.readOne(scope, relName)
		}
		if (scope.type === 'project' && relName === 'activeTimeline' && toDktScope(scope)) {
			return scope
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && relName === 'activeProject') {
			return readActiveProjectScope(pageRuntime, legacyRuntime)
		}
		if ((scope === SESSION_SCOPE || scope.type === 'session') && relName === 'selectedEntity') {
			const selectedSourceId = pageRuntime.getRootAttrs(['selectedEntityId']).selectedEntityId
				?? legacyRuntime.readAttrs(SESSION_SCOPE, ['selectedEntityId']).selectedEntityId
			return typeof selectedSourceId === 'string' ? findDktScopeBySourceId(pageRuntime, selectedSourceId) : null
		}

		const dktScope = toDktScope(scope)
		return dktScope ? toEditorScope(pageRuntime, pageRuntime.readOne(dktScope, relName), TYPE_BY_REL[relName] ?? 'root') : legacyRuntime.readOne(scope, relName)
	},
	subscribeOne(scope, relName, listener) {
		if (!pageRuntime?.getRootScope()) {
			return legacyRuntime.subscribeOne(scope, relName, listener)
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && relName === 'activeProject') {
			return combineCleanups([subscribeActiveProject(pageRuntime, listener), legacyRuntime.subscribeOne(ROOT_SCOPE, relName, listener)])
		}
		if ((scope === SESSION_SCOPE || scope.type === 'session') && relName === 'selectedEntity') {
			return combineCleanups([pageRuntime.subscribeRootAttrs(['selectedEntityId'], listener), legacyRuntime.subscribeOne(SESSION_SCOPE, relName, listener)])
		}
		if (scope.type === 'project' && relName === 'activeTimeline' && toDktScope(scope)) {
			return EMPTY_CLEANUP
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.subscribeOne(dktScope, relName, listener) : legacyRuntime.subscribeOne(scope, relName, listener)
	},
	readMany(scope, relName) {
		if (!pageRuntime?.getRootScope()) {
			return legacyRuntime.readMany(scope, relName)
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && (relName === 'projects' || relName === 'project')) {
			return readProjectScopes(pageRuntime).map((projectScope) => toEditorScope(pageRuntime, projectScope, 'project')).filter((item): item is EditorScope => item != null)
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.readMany(dktScope, relName).map((item) => toEditorScope(pageRuntime, item, TYPE_BY_REL[relName] ?? 'root')).filter((item): item is EditorScope => item != null) : legacyRuntime.readMany(scope, relName)
	},
	subscribeMany(scope, relName, listener) {
		if (!pageRuntime?.getRootScope()) {
			return legacyRuntime.subscribeMany(scope, relName, listener)
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && (relName === 'projects' || relName === 'project')) {
			return combineCleanups([subscribeActiveProject(pageRuntime, listener), legacyRuntime.subscribeMany(ROOT_SCOPE, relName, listener)])
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.subscribeMany(dktScope, relName, listener) : legacyRuntime.subscribeMany(scope, relName, listener)
	},
	readComp(scope, compName) {
		if (!pageRuntime) {
			return legacyRuntime.readComp(scope, compName)
		}
		const sourceId = findSourceIdForDktScope(pageRuntime, scope)
		const sourceType = sourceId && scope.type !== 'root' && scope.type !== 'session' ? scope.type as EntityType : null
		return sourceId && sourceType
			? legacyRuntime.readComp({ nodeId: sourceId, type: sourceType }, compName)
			: legacyRuntime.readComp(scope, compName)
	},
	subscribeComp(scope, compName, listener) {
		return legacyRuntime.subscribeComp(scope, compName, listener)
	},
	getDispatch(scope = ROOT_SCOPE) {
		return createScopedDispatch(pageRuntime, legacyRuntime, actions, scope)
	},
})
