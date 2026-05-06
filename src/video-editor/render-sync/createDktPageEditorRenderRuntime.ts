import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { EditorActionName, EditorActionPayload } from './actionRequests'
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
	actions?: HarnessActions
}

const SOURCE_ATTR_BY_TYPE: Partial<Record<EntityType, string>> = {
	project: 'sourceProjectId',
	track: 'sourceTrackId',
	resource: 'sourceResourceId',
	clip: 'sourceClipId',
	text: 'sourceTextId',
	effect: 'sourceEffectId',
}

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

const DKT_REL_BY_UI_REL: Record<string, string> = {
	tracks: 'tracks',
	resources: 'resources',
	clips: 'clips',
	effects: 'effects',
}

const toDktRelName = (relName: string): string => DKT_REL_BY_UI_REL[relName] ?? relName

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

const toEditorScope = (scope: ReactSyncScopeHandle | null, fallbackType: EditorScope['type'] = 'root'): EditorScope | null => {
	if (!scope) {
		return null
	}

	return {
		nodeId: scope._nodeId,
		type: fallbackType,
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

const findSourceIdForDktScope = (runtime: PageSyncRuntime, scope: EditorScope | null): string | null => {
	if (!scope || scope === ROOT_SCOPE || scope === SESSION_SCOPE || scope.nodeId.startsWith('$')) {
		return null
	}

	const sourceAttr = SOURCE_ATTR_BY_TYPE[scope.type as EntityType]
	const dktScope = toDktScope(scope)
	const sourceId = sourceAttr && dktScope ? runtime.readAttrs(dktScope, [sourceAttr])[sourceAttr] : null
	return typeof sourceId === 'string' ? sourceId : null
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

const readActiveProjectScope = (runtime: PageSyncRuntime): EditorScope | null => {
	const activeProjectId = runtime.getRootAttrs(['activeProjectId']).activeProjectId
	const projects = readProjectScopes(runtime)
	const matched = typeof activeProjectId === 'string'
		? projects.find((projectScope) => runtime.readAttrs(projectScope, ['sourceProjectId']).sourceProjectId === activeProjectId)
		: null
	const pendingActiveProject = typeof activeProjectId === 'string' && projects.length > 0
		? projects[projects.length - 1]
		: null

	return toEditorScope(matched ?? pendingActiveProject ?? projects[0] ?? null, 'project')
}

const readSelectedClipScope = (runtime: PageSyncRuntime): EditorScope | null => {
	const root = getPageRoot(runtime)
	const selectedClip = root ? runtime.readOne(root, 'selectedClip') : null
	if (selectedClip) {
		return toEditorScope(selectedClip, 'clip')
	}

	const selectedEntityId = runtime.getRootAttrs(['selectedEntityId']).selectedEntityId
	return typeof selectedEntityId === 'string' && selectedEntityId
		? { nodeId: selectedEntityId, type: 'clip' }
		: null
}

const subscribeActiveProject = (runtime: PageSyncRuntime, listener: () => void): (() => void) => {
	let stopProjectList: (() => void) | null = null
	let stopProjectAttrs: Array<() => void> = []
	const bindProjectList = () => {
		stopProjectList?.()
		for (const stop of stopProjectAttrs) {
			stop()
		}
		stopProjectAttrs = []
		const pioneer = getPioneerScope(runtime)
		const projects = pioneer ? runtime.readMany(pioneer, 'project') : EMPTY_LIST
		stopProjectAttrs = projects.map((projectScope) => runtime.subscribeAttrs(projectScope, ['sourceProjectId'], listener))
		stopProjectList = pioneer ? runtime.subscribeMany(pioneer, 'project', rebindAndNotify) : null
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
		() => {
			stopProjectList?.()
			for (const stop of stopProjectAttrs) {
				stop()
			}
		},
	])
}

const normalizeRootAttrs = (
	runtime: PageSyncRuntime,
	fields: readonly string[],
): Record<string, unknown> => {
	const rootAttrs = runtime.getRootAttrs(fields)
	const result: Record<string, unknown> = {}

	for (const field of fields) {
		if (field === 'projectCount') {
			result[field] = readProjectScopes(runtime).length
			continue
		}

		result[field] = rootAttrs[field]
	}

	return result
}

const normalizeSessionAttrs = (
	runtime: PageSyncRuntime,
	fields: readonly string[],
): Record<string, unknown> => {
	const rootAttrs = runtime.getRootAttrs(fields)
	const result: Record<string, unknown> = {}

	for (const field of fields) {
		if (field === 'selectedEntityId') {
			const selectedScope = readSelectedClipScope(runtime)
			result[field] = selectedScope?.nodeId ?? null
			continue
		}

		result[field] = rootAttrs[field]
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

const dispatchSessionDktAction = (
	runtime: PageSyncRuntime | null,
	actionName: EditorActionName,
	payload: unknown,
): boolean => {
	const rootScope = getPageRoot(runtime)
	if (actionName === 'setCursor') {
		const value = getNumberPayload(payload, 'value')
		if (value !== null) {
			runtime?.dispatch('setCursor', value, rootScope)
		}
		return true
	}
	if (actionName === 'zoomTimeline') {
		const delta = getNumberPayload(payload, 'delta')
		if (delta !== null) {
			runtime?.dispatch('zoomTimeline', delta, rootScope)
		}
		return true
	}
	if (actionName === 'togglePlayback') {
		runtime?.dispatch('togglePlayback', undefined, rootScope)
		return true
	}
	if (actionName === 'setActiveProject') {
		const projectId = typeof payload === 'string' ? payload : getStringPayload(payload, 'projectId')
		if (projectId) {
			runtime?.dispatch('setActiveProject', projectId, rootScope)
		}
		return true
	}
	if (actionName === 'setActiveInspectorTab') {
		const tab = (payload as Record<string, unknown> | null)?.tab
		if (tab === 'edit' || tab === 'color' || tab === 'audio' || tab === 'export') {
			runtime?.dispatch('setActiveInspectorTab', tab, rootScope)
		}
		return true
	}

	return false
}

const createScopedDispatch = (
	runtime: PageSyncRuntime | null,
	actions: HarnessActions | undefined,
	scope: EditorScope | null,
): EditorScopedDispatch => ((actionName, payload) => {
	if (!runtime) {
		return
	}

	if (!scope || scope === ROOT_SCOPE || scope === SESSION_SCOPE || scope.nodeId.startsWith('$')) {
		dispatchSessionDktAction(runtime, actionName, payload)
		return
	}

	const sourceId = findSourceIdForDktScope(runtime, scope)
	const dktScope = toDktScope(scope)

	if (scope.type === 'clip' && dktScope) {
		if (actionName === 'select') {
			runtime.dispatch('selectEntity', scope.nodeId, getPageRoot(runtime))
			return
		}
		if (actionName === 'moveBy') {
			const delta = getNumberPayload(payload, 'delta')
			if (delta !== null) {
				runtime.dispatch('moveBy', { delta }, dktScope)
			}
			return
		}
		if (actionName === 'resize' || actionName === 'trim') {
			const edge = (payload as Record<string, unknown> | null)?.edge
			const delta = getNumberPayload(payload, 'delta')
			if ((edge === 'start' || edge === 'end') && delta !== null) {
				runtime.dispatch(actionName, { edge, delta }, dktScope)
			}
			return
		}
		if (actionName === 'splitAt') {
			const time = getNumberPayload(payload, 'time')
			if (time !== null) {
				runtime.dispatch('splitAt', { time }, dktScope)
			}
			return
		}
		if (actionName === 'rename') {
			const name = getStringPayload(payload, 'name')
			if (name !== null) {
				runtime.dispatch('rename', { name }, dktScope)
			}
			return
		}
		if (actionName === 'color') {
			const color = getStringPayload(payload, 'color')
			if (color !== null) {
				runtime.dispatch('color', { color }, dktScope)
			}
			return
		}
		if (actionName === 'setOpacity') {
			const opacityPercent = getNumberPayload(payload, 'opacityPercent')
			if (opacityPercent !== null) {
				runtime.dispatch('updateOpacity', { opacityPercent }, dktScope)
			}
			return
		}
		if (actionName === 'setFade') {
			const edge = (payload as Record<string, unknown> | null)?.edge
			const delta = getNumberPayload(payload, 'delta')
			if ((edge === 'in' || edge === 'out') && delta !== null) {
				runtime.dispatch('setFade', { edge, delta }, dktScope)
			}
			return
		}
		if (actionName === 'setTransform') {
			runtime.dispatch('setTransform', payload, dktScope)
			return
		}
		if (actionName === 'setAudio') {
			runtime.dispatch('setAudio', payload, dktScope)
			return
		}
		if (actionName === 'addEffect') {
			const kind = (payload as Record<string, unknown> | null)?.kind
			if (kind === 'blur' || kind === 'sharpen' || kind === 'tint') {
				runtime.dispatch('addEffect', { kind }, dktScope)
			}
			return
		}
		if (actionName === 'addColorCorrection') {
			runtime.dispatch('addEffect', { kind: 'tint' }, dktScope)
			return
		}
		if (actionName === 'removeEffect') {
			const effectId = getStringPayload(payload, 'effectId')
			if (effectId !== null) {
				runtime.dispatch('removeEffect', { effectId }, dktScope)
			}
			return
		}
	}

	if (scope.type === 'resource' && sourceId && actionName === 'addResourceToTimeline') {
		return
	}

	if (scope.type === 'text' && dktScope && actionName === 'updateText') {
		const value = payload as Record<string, unknown> | null
		if (typeof value?.content === 'string') {
			runtime.dispatch('setTextContent', { content: value.content }, dktScope)
		}
		if (value?.style && typeof value.style === 'object') {
			runtime.dispatch('setTextStyle', { style: value.style }, dktScope)
		}
		if (value?.box && typeof value.box === 'object') {
			runtime.dispatch('setTextBox', { box: value.box }, dktScope)
		}
		return
	}

	if (scope.type === 'effect' && dktScope && actionName === 'updateEffect') {
		const value = payload as Record<string, unknown> | null
		if ('name' in (value ?? {})) {
			runtime.dispatch('setEffectName', { name: value?.name }, dktScope)
		}
		if ('kind' in (value ?? {})) {
			runtime.dispatch('setEffectKind', { kind: value?.kind }, dktScope)
		}
		if ('enabled' in (value ?? {})) {
			runtime.dispatch('setEffectEnabled', { enabled: value?.enabled }, dktScope)
		}
		if ('amount' in (value ?? {})) {
			runtime.dispatch('setEffectAmount', { amount: value?.amount }, dktScope)
		}
		if ('params' in (value ?? {})) {
			runtime.dispatch('setEffectParams', { params: value?.params }, dktScope)
		}
		if ('color' in (value ?? {})) {
			runtime.dispatch('setEffectColor', { color: value?.color }, dktScope)
		}
		return
	}
}) as EditorScopedDispatch

export const createDktPageEditorRenderRuntime = ({
	pageRuntime,
	actions,
}: CreateDktPageEditorRenderRuntimeOptions): EditorRenderRuntime => ({
	getRootScope: () => ROOT_SCOPE,
	getSessionScope: () => SESSION_SCOPE,
	readAttrs(scope, fields) {
		if (!pageRuntime) {
			return Object.fromEntries(fields.map((field) => [field, undefined]))
		}
		if (scope === ROOT_SCOPE || scope.type === 'root') {
			return normalizeRootAttrs(pageRuntime, fields)
		}
		if (scope === SESSION_SCOPE || scope.type === 'session') {
			return normalizeSessionAttrs(pageRuntime, fields)
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.readAttrs(dktScope, fields) : Object.fromEntries(fields.map((field) => [field, undefined]))
	},
	subscribeAttrs(scope, fields, listener) {
		if (!pageRuntime) {
			return EMPTY_CLEANUP
		}
		if (scope === ROOT_SCOPE || scope.type === 'root') {
			return combineCleanups([
				pageRuntime.subscribeRootAttrs(fields.filter((field) => field !== 'projectCount'), listener),
				fields.includes('projectCount') ? subscribeActiveProject(pageRuntime, listener) : EMPTY_CLEANUP,
			])
		}
		if (scope === SESSION_SCOPE || scope.type === 'session') {
			return pageRuntime.subscribeRootAttrs(fields, listener)
		}

		const dktScope = toDktScope(scope)
		return dktScope ? pageRuntime.subscribeAttrs(dktScope, fields, listener) : EMPTY_CLEANUP
	},
	readOne(scope, relName) {
		if (!pageRuntime) {
			return null
		}
		if (scope.type === 'project' && relName === 'activeTimeline' && toDktScope(scope)) {
			return scope
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && relName === 'activeProject') {
			return readActiveProjectScope(pageRuntime)
		}
		if ((scope === SESSION_SCOPE || scope.type === 'session') && relName === 'selectedEntity') {
			return readSelectedClipScope(pageRuntime)
		}

		const dktScope = toDktScope(scope)
		if (!dktScope) {
			return null
		}
		const dktRelName = toDktRelName(relName)
		return toEditorScope(pageRuntime.readOne(dktScope, dktRelName), TYPE_BY_REL[relName] ?? TYPE_BY_REL[dktRelName] ?? 'root')
	},
	subscribeOne(scope, relName, listener) {
		if (!pageRuntime) {
			return EMPTY_CLEANUP
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && relName === 'activeProject') {
			return subscribeActiveProject(pageRuntime, listener)
		}
		if ((scope === SESSION_SCOPE || scope.type === 'session') && relName === 'selectedEntity') {
			const root = getPageRoot(pageRuntime)
			return combineCleanups([
				root ? pageRuntime.subscribeOne(root, 'selectedClip', listener) : EMPTY_CLEANUP,
				pageRuntime.subscribeRootAttrs(['selectedEntityId'], listener),
			])
		}
		if (scope.type === 'project' && relName === 'activeTimeline' && toDktScope(scope)) {
			return EMPTY_CLEANUP
		}

		const dktScope = toDktScope(scope)
		if (!dktScope) {
			return EMPTY_CLEANUP
		}
		return pageRuntime.subscribeOne(dktScope, toDktRelName(relName), listener)
	},
	readMany(scope, relName) {
		if (!pageRuntime) {
			return []
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && (relName === 'projects' || relName === 'project')) {
			return readProjectScopes(pageRuntime).map((projectScope) => toEditorScope(projectScope, 'project')).filter((item): item is EditorScope => item != null)
		}

		const dktScope = toDktScope(scope)
		if (!dktScope) {
			return []
		}
		const dktRelName = toDktRelName(relName)
		return pageRuntime.readMany(dktScope, dktRelName)
			.map((item) => toEditorScope(item, TYPE_BY_REL[relName] ?? TYPE_BY_REL[dktRelName] ?? 'root'))
			.filter((item): item is EditorScope => item != null)
	},
	subscribeMany(scope, relName, listener) {
		if (!pageRuntime) {
			return EMPTY_CLEANUP
		}
		if ((scope === ROOT_SCOPE || scope.type === 'root') && (relName === 'projects' || relName === 'project')) {
			return subscribeActiveProject(pageRuntime, listener)
		}

		const dktScope = toDktScope(scope)
		if (!dktScope) {
			return EMPTY_CLEANUP
		}
		return pageRuntime.subscribeMany(dktScope, toDktRelName(relName), listener)
	},
	readComp(scope, compName) {
		if (!pageRuntime) {
			return null
		}
		return null
	},
	subscribeComp(scope, compName, listener) {
		return EMPTY_CLEANUP
	},
	getDispatch(scope = ROOT_SCOPE) {
		return createScopedDispatch(pageRuntime, actions, scope)
	},
})
