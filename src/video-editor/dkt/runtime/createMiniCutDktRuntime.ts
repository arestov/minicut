import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import type { DomSyncTransportLike, DomSyncTransportViewLike } from 'dkt/dom-sync/transport.js'
import { _getCurrentRel, _listRels } from 'dkt-all/libs/provoda/_internal/_listRels.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
import { buildDispatchResult } from '../../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../../domain/applyPatch'
import {
	getClipEntitiesForTrack,
	getProjectEntity,
	getResourceEntities,
	getTracks,
} from '../../domain/selectors'
import type {
	ClipAttrs,
	Command,
	DispatchResult,
	EffectAttrs,
	ProjectAttrs,
	ProjectGraph,
	ProjectRegistry,
	ResourceAttrs,
	TextAttrs,
	TrackAttrs,
} from '../../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'
import { MiniCutAppRoot } from '../../models/AppRoot'
import { createPreviewFrameFromRegistry, createSelectedClipSummaryFromRegistry, createSelectedClipTrackPositionFromRegistry } from './previewModelFromRegistry'

type RuntimeModelLike = {
	_node_id?: string | null
	model_name?: string | null
	states?: Record<string, unknown>
	__getPublicAttrs?: () => readonly string[]
	getLinedStructure?: (options: unknown, config: unknown) => Promise<readonly RuntimeModelLike[]> | readonly RuntimeModelLike[]
	input?: (callback: () => void | Promise<void>) => unknown
	queryRel?: (relName: string) => Promise<unknown> | unknown
	dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
	start_page?: unknown
}

type RuntimeLike = {
	start(options: {
		App: typeof MiniCutAppRoot
		interfaces: Record<string, unknown>
	}): Promise<{ app_model: RuntimeModelLike }>
	sync_sender: {
		addSyncStream(
			root: RuntimeModelLike,
			stream: ReturnType<typeof createWorkerStream>,
			importantRelPaths: readonly (readonly string[])[],
		): Promise<void> | void
		removeSyncStream(stream: ReturnType<typeof createWorkerStream>): void
		updateStructureUsage(streamId: string, data: unknown): void
		requireShapeForModel(streamId: string, data: unknown): void
	}
	models?: Record<string, RuntimeModelLike>
}

const createWorkerStream = (transport: DomSyncTransportViewLike<MiniCutDktTransportMessage>) => ({
	id: `minicut-stream-${Math.random().toString(36).slice(2)}`,
	send(list: unknown[]) {
		transport.send({ type: DKT_MSG.SYNC_HANDLE, syncType: SYNCR_TYPES.UPDATE, payload: list.slice() })
	},
	sendDict(dict: unknown[]) {
		transport.send({ type: DKT_MSG.SYNC_HANDLE, syncType: SYNCR_TYPES.SET_DICT, payload: dict.slice() })
	},
	sendWithType(syncType: number, payload: unknown) {
		transport.send({ type: DKT_MSG.SYNC_HANDLE, syncType, payload })
	},
})

export type MiniCutDktProjectProxyInput = {
	sourceProjectId: string
	title?: string
	fps?: number
	width?: number
	height?: number
	duration?: number
	createdAt?: number
	updatedAt?: number
}

export type MiniCutDktTrackProxyInput = {
	sourceTrackId: string
	kind?: 'video' | 'audio'
	name?: string
	muted?: boolean
	locked?: boolean
	height?: number
}

export type MiniCutDktResourceProxyInput = {
	sourceResourceId: string
	name?: string
	kind?: string
	url?: string
	mime?: string
	duration?: number
	width?: number
	height?: number
	size?: number
	source?: Record<string, unknown>
	status?: string
	data?: Record<string, unknown>
}

export type MiniCutDktClipProxyInput = {
	sourceClipId: string
	sourceResourceId?: string | null
	sourceTextId?: string | null
	name?: string
	color?: string
	start?: number
	in?: number
	duration?: number
	fadeIn?: number
	fadeOut?: number
	audio?: { gain: number; pan: number }
	opacity?: { value: number }
	transform?: {
		x: { value: number }
		y: { value: number }
		scale: { value: number }
		rotation: { value: number }
	}
}

export type MiniCutDktTextProxyInput = {
	sourceTextId: string
	content?: string
	style?: Record<string, unknown>
	box?: Record<string, unknown>
}

export type MiniCutDktEffectProxyInput = {
	sourceEffectId: string
	name?: string
	kind?: string
	enabled?: boolean
	amount?: number
	params?: Record<string, unknown>
	color?: Record<string, unknown>
}

export type MiniCutDktSerializedModel = {
	nodeId: string | null
	modelName: string | null
	attrs: Record<string, unknown>
	rels: Record<string, unknown>
}

export type MiniCutDktDebugState = {
	lined: MiniCutDktSerializedModel[]
	runtimeModels: MiniCutDktSerializedModel[]
} | null

const serializeModelRef = (value: unknown): unknown => {
	if (value == null) {
		return null
	}
	if (Array.isArray(value)) {
		return value.map(serializeModelRef)
	}
	if (typeof value === 'object' && '_node_id' in value) {
		return (value as { _node_id?: unknown })._node_id ?? null
	}
	return value
}

const serializeModel = (model: RuntimeModelLike): MiniCutDktSerializedModel => {
	const publicAttrs = model.__getPublicAttrs?.() ?? []
	const attrs = Object.fromEntries(
		publicAttrs.map((attrName) => [attrName, serializeModelRef(model.states?.[attrName])]),
	)
	const relNames = Array.from(_listRels(model)).sort()
	const rels = Object.fromEntries(
		relNames.map((relName) => [relName, serializeModelRef(_getCurrentRel(model, relName))]),
	)

	return {
		nodeId: model._node_id ?? null,
		modelName: model.model_name ?? null,
		attrs,
		rels,
	}


}

const SESSION_IMPORTANT_REL_PATHS = Object.freeze([
	Object.freeze(['pioneer']),
	Object.freeze(['activeProject']),
	Object.freeze(['selectedClip']),
	Object.freeze(['pioneer', 'project']),
	Object.freeze(['pioneer', 'project', 'tracks']),
	Object.freeze(['pioneer', 'project', 'resources']),
	Object.freeze(['pioneer', 'project', 'tracks', 'clips']),
	Object.freeze(['pioneer', 'project', 'tracks', 'clips', 'resource']),
	Object.freeze(['pioneer', 'project', 'tracks', 'clips', 'text']),
	Object.freeze(['pioneer', 'project', 'tracks', 'clips', 'effects']),
	Object.freeze(['activeProject', 'tracks']),
	Object.freeze(['activeProject', 'resources']),
	Object.freeze(['activeProject', 'tracks', 'clips']),
	Object.freeze(['activeProject', 'tracks', 'clips', 'resource']),
	Object.freeze(['activeProject', 'tracks', 'clips', 'text']),
	Object.freeze(['activeProject', 'tracks', 'clips', 'effects']),
	Object.freeze(['pioneer', 'effect']),
])

const MODEL_ROOT_REL_BY_MODEL_NAME: Partial<Record<string, string>> = {
	minicut_project: 'project',
	minicut_track: 'track',
	minicut_resource: 'resource',
	minicut_clip: 'clip',
	minicut_text: 'text',
	minicut_effect: 'effect',
}

const isRuntimeModelLike = (value: unknown): value is RuntimeModelLike =>
	Boolean(value && typeof value === 'object' && '_node_id' in value)

const normalizeModelList = (value: unknown): RuntimeModelLike[] => {
	if (Array.isArray(value)) {
		return value.filter(isRuntimeModelLike)
	}

	return isRuntimeModelLike(value) ? [value] : []
}

const queryModelRel = async (model: RuntimeModelLike, relName: string): Promise<RuntimeModelLike[]> => {
	const queried = await model.queryRel?.(relName)
	return normalizeModelList(queried ?? _getCurrentRel(model, relName))
}

const readInModelInput = async <Value>(model: RuntimeModelLike, read: () => Promise<Value> | Value): Promise<Value> => {
	if (typeof model.input !== 'function') {
		return read()
	}

	return new Promise((resolve, reject) => {
		model.input(async () => {
			try {
				resolve(await read())
			} catch (error) {
				reject(error)
			}
		})
	})
}

const asProjectAttrs = (attrs: Record<string, unknown>): ProjectAttrs => attrs as unknown as ProjectAttrs
const asTrackAttrs = (attrs: Record<string, unknown>): TrackAttrs => attrs as unknown as TrackAttrs
const asResourceAttrs = (attrs: Record<string, unknown>): ResourceAttrs => attrs as unknown as ResourceAttrs
const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs
const asTextAttrs = (attrs: Record<string, unknown>): TextAttrs => attrs as unknown as TextAttrs
const asEffectAttrs = (attrs: Record<string, unknown>): EffectAttrs => attrs as unknown as EffectAttrs

const toProjectProxy = (snapshot: ProjectRegistry, project: ProjectGraph): MiniCutDktProjectProxyInput => {
	const projectEntity = getProjectEntity(snapshot, project)
	const attrs = asProjectAttrs(projectEntity.attrs)

	return {
		sourceProjectId: project.id,
		title: attrs.title,
		fps: attrs.fps,
		width: attrs.width,
		height: attrs.height,
		duration: attrs.duration,
		createdAt: attrs.createdAt,
		updatedAt: attrs.updatedAt,
	}
}

const toTrackProxy = (track: { id: string; attrs: Record<string, unknown> }): MiniCutDktTrackProxyInput => {
	const attrs = asTrackAttrs(track.attrs)
	return {
		sourceTrackId: track.id,
		kind: attrs.kind,
		name: attrs.name,
		muted: attrs.muted,
		locked: attrs.locked,
		height: attrs.height,
	}
}

const toResourceProxy = (resource: { id: string; attrs: Record<string, unknown> }): MiniCutDktResourceProxyInput => {
	const attrs = asResourceAttrs(resource.attrs)
	return {
		sourceResourceId: resource.id,
		name: attrs.name,
		kind: attrs.kind,
		url: attrs.url,
		mime: attrs.mime,
		duration: attrs.duration,
		width: attrs.width,
		height: attrs.height,
		size: attrs.size,
		source: attrs.source,
		status: attrs.status,
		data: attrs.data,
	}
}

const toClipProxy = (clip: { id: string; attrs: Record<string, unknown>; rels: Record<string, unknown> }): MiniCutDktClipProxyInput => {
	const attrs = asClipAttrs(clip.attrs)
	return {
		sourceClipId: clip.id,
		sourceResourceId: typeof clip.rels.resource === 'string' ? clip.rels.resource : null,
		sourceTextId: typeof clip.rels.text === 'string' ? clip.rels.text : null,
		name: attrs.name,
		color: attrs.color,
		start: attrs.start,
		in: attrs.in,
		duration: attrs.duration,
		fadeIn: attrs.fadeIn,
		fadeOut: attrs.fadeOut,
		audio: attrs.audio,
		opacity: attrs.opacity,
		transform: attrs.transform,
	}
}

const toTextProxy = (text: { id: string; attrs: Record<string, unknown> }): MiniCutDktTextProxyInput => {
	const attrs = asTextAttrs(text.attrs)
	return {
		sourceTextId: text.id,
		content: attrs.content,
		style: attrs.style,
		box: attrs.box,
	}
}

const toEffectProxy = (effect: { id: string; attrs: Record<string, unknown> }): MiniCutDktEffectProxyInput => {
	const attrs = asEffectAttrs(effect.attrs)
	return {
		sourceEffectId: effect.id,
		name: attrs.name,
		kind: attrs.kind,
		enabled: attrs.enabled,
		amount: attrs.amount,
		params: attrs.params as Record<string, unknown> | undefined,
		color: attrs.color as Record<string, unknown> | undefined,
	}
}

export const createMiniCutDktRuntime = (options: { enabled?: boolean } = {}) => {
	let bootPromise: Promise<{ runtime: RuntimeLike; appModel: RuntimeModelLike }> | null = null
	const sessionRootPromises = new Map<string, Promise<RuntimeModelLike>>()
	const clipProxyNodeIds = new Map<string, string>()
	const projectProxyNodeIds = new Map<string, string>()
	const trackProxyNodeIds = new Map<string, string>()
	const resourceProxyNodeIds = new Map<string, string>()
	const textProxyNodeIds = new Map<string, string>()
	const effectProxyNodeIds = new Map<string, string>()
	const enabled = options.enabled === true

	const bootstrapApp = async () => {
		if (!enabled) {
			return null
		}

		if (!bootPromise) {
			bootPromise = (async () => {
				const runtime = prepareAppRuntime({
					sync_sender: true,
					warnUnexpectedAttrs: true,
				}) as RuntimeLike
				const inited = await runtime.start({
					App: MiniCutAppRoot,
					interfaces: {
						time: {
							setTimeout: globalThis.setTimeout.bind(globalThis),
							clearTimeout: globalThis.clearTimeout.bind(globalThis),
							Date: globalThis.Date,
						},
					},
				})

				return { runtime, appModel: inited.app_model }
			})()
		}

		return bootPromise
	}

	const bootstrapSessionRoot = async (sessionKey = 'minicut-local'): Promise<RuntimeModelLike | null> => {
		const app = await bootstrapApp()
		if (!app) {
			return null
		}

		const cached = sessionRootPromises.get(sessionKey)
		if (cached) {
			return cached
		}

		const sessionRootPromise = new Promise<RuntimeModelLike>((resolve, reject) => {
				const createSessionRoot = async () => {
					try {
						const sessionRoot = await hookSessionRoot(app.appModel, app.appModel.start_page, {
							sessionKey,
							route: null,
						})
						resolve(sessionRoot as RuntimeModelLike)
					} catch (error) {
						reject(error)
					}
				}

				if (typeof app.appModel.input === 'function') {
					app.appModel.input(createSessionRoot)
					return
				}

				createSessionRoot()
			})

		sessionRootPromises.set(sessionKey, sessionRootPromise)

		return sessionRootPromise
	}

	const dispatchAction = async (
		actionName: string,
		payload?: unknown,
		scopeNodeId?: string | null,
		sessionKey = 'minicut-local',
	): Promise<void> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		let target = app.appModel
		if (typeof scopeNodeId === 'string' && scopeNodeId) {
			const sessionRoot = await bootstrapSessionRoot(sessionKey)
			target = (
				(sessionRoot ? getModelById(sessionRoot, scopeNodeId) as RuntimeModelLike | null : null)
				?? (getModelById(app.appModel, scopeNodeId) as RuntimeModelLike | null)
				?? target
			)
		}

		await target.dispatch(actionName, payload)
	}

	const dispatchScopedAction = async (
		actionName: string,
		payload?: unknown,
		scopeNodeId?: string | null,
		sessionKey = 'minicut-local',
	): Promise<void> => {
		const sessionRoot = await bootstrapSessionRoot(sessionKey)
		if (!sessionRoot) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		let target = sessionRoot
		if (typeof scopeNodeId === 'string' && scopeNodeId) {
			const scopedTarget = getModelById(sessionRoot, scopeNodeId) as RuntimeModelLike | null
			if (!scopedTarget) {
				throw new Error(`MiniCut DKT scope was not found: ${scopeNodeId}`)
			}

			target = scopedTarget
		}

		await target.dispatch(actionName, payload)
		if (target === sessionRoot) {
			await syncSessionDerivedState(sessionRoot)
		}
	}

	const dispatchSessionAction = async (actionName: string, payload?: unknown): Promise<void> => {
		const sessionRoot = await bootstrapSessionRoot()
		if (!sessionRoot) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		await sessionRoot.dispatch(actionName, payload)
		await syncSessionDerivedState(sessionRoot)
	}

	const getRegistrySnapshot = async (): Promise<ProjectRegistry> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		return structuredClone(app.appModel.states?.registrySnapshot as ProjectRegistry)
	}

	const replaceRegistrySnapshot = async (snapshot: ProjectRegistry): Promise<void> => {
		await dispatchAction('replaceRegistrySnapshot', snapshot)
		await materializeRegistryHierarchy(snapshot)
		const sessionRoot = await bootstrapSessionRoot()
		if (sessionRoot) {
			await syncSessionDerivedState(sessionRoot)
		}
	}

	const dispatchCommand = async (command: Command): Promise<DispatchResult> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		const registry = structuredClone(app.appModel.states?.registrySnapshot as ProjectRegistry)
		const result = buildDispatchResult(registry, command)
		const nextSnapshot = applyPatchEnvelopeToRegistry(registry, result.envelope)
		await app.appModel.dispatch('replaceRegistrySnapshot', nextSnapshot)
		await materializeRegistryHierarchy(nextSnapshot)
		const sessionRoot = await bootstrapSessionRoot()
		if (sessionRoot) {
			await syncSessionDerivedState(sessionRoot)
		}
		return structuredClone(result)
	}

	const findProxyNodeId = async (modelName: string, sourceAttrName: string, sourceId: string): Promise<string | null> => {
		const app = await bootstrapApp()
		if (!app) {
			return null
		}

		const relName = MODEL_ROOT_REL_BY_MODEL_NAME[modelName]
		if (!relName) {
			return null
		}

		return readInModelInput(app.appModel, async () => {
			const models = await queryModelRel(app.appModel, relName)
			const match = models.find((model) => (
				model.model_name === modelName
				&& model.states?.[sourceAttrName] === sourceId
				&& typeof model._node_id === 'string'
			))

			return match?._node_id ?? null
		})
	}

	const ensureProxy = async (
		cache: Map<string, string>,
		input: object,
		modelName: string,
		sourceAttrName: string,
		createActionName: string,
		sourceId: string,
	): Promise<string> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		const cachedNodeId = cache.get(sourceId)
		if (cachedNodeId && getModelById(app.appModel, cachedNodeId)) {
			return cachedNodeId
		}

		const existingNodeId = await findProxyNodeId(modelName, sourceAttrName, sourceId)
		if (existingNodeId) {
			cache.set(sourceId, existingNodeId)
			return existingNodeId
		}

		await app.appModel.dispatch(createActionName, input)
		const createdNodeId = await findProxyNodeId(modelName, sourceAttrName, sourceId)
		if (!createdNodeId) {
			throw new Error(`MiniCut DKT ${modelName} proxy was not created for ${sourceId}`)
		}

		cache.set(sourceId, createdNodeId)
		return createdNodeId
	}

	const getProxyModelByNodeId = async (nodeId: string): Promise<unknown> => {
		const app = await bootstrapApp()
		const model = app ? getModelById(app.appModel, nodeId) : null
		if (!model) {
			throw new Error(`MiniCut DKT proxy model is not available for ${nodeId}`)
		}
		return model
	}

	const findProxyModelBySourceId = async (modelName: string, sourceAttrName: string, sourceId: string | null): Promise<unknown | null> => {
		if (!sourceId) {
			return null
		}

		const nodeId = await findProxyNodeId(modelName, sourceAttrName, sourceId)
		return nodeId ? getProxyModelByNodeId(nodeId) : null
	}

	const syncSessionSelectionRels = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		const activeProjectId = typeof sessionRoot.states?.activeProjectId === 'string'
			? sessionRoot.states.activeProjectId
			: null
		const selectedEntityId = typeof sessionRoot.states?.selectedEntityId === 'string'
			? sessionRoot.states.selectedEntityId
			: null

		const activeProject = await findProxyModelBySourceId('minicut_project', 'sourceProjectId', activeProjectId)
		const selectedClip = await findProxyModelBySourceId('minicut_clip', 'sourceClipId', selectedEntityId)
		await sessionRoot.dispatch('syncActiveProjectRel', { project: activeProject })
		await sessionRoot.dispatch('syncSelectedClipRel', { clip: selectedClip })
	}

	const syncSessionPreviewAttrs = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		const app = await bootstrapApp()
		const snapshot = app?.appModel.states?.registrySnapshot as ProjectRegistry | undefined
		if (!snapshot) {
			await sessionRoot.dispatch('syncPreviewModel', null)
			return
		}

		const activeProjectId = typeof sessionRoot.states?.activeProjectId === 'string'
			? sessionRoot.states.activeProjectId
			: null
		const cursor = Number(sessionRoot.states?.cursor ?? 0)
		const { structure, frame } = createPreviewFrameFromRegistry(snapshot, activeProjectId, Number.isFinite(cursor) ? cursor : 0)
		await sessionRoot.dispatch('syncPreviewModel', { structure, frame })
	}

	const syncSessionSelectedClipTrackPosition = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		const app = await bootstrapApp()
		const snapshot = app?.appModel.states?.registrySnapshot as ProjectRegistry | undefined
		if (!snapshot) {
			await sessionRoot.dispatch('syncSelectedClipTrackPosition', null)
			return
		}

		const activeProjectId = typeof sessionRoot.states?.activeProjectId === 'string'
			? sessionRoot.states.activeProjectId
			: null
		const selectedEntityId = typeof sessionRoot.states?.selectedEntityId === 'string'
			? sessionRoot.states.selectedEntityId
			: null
		const position = createSelectedClipTrackPositionFromRegistry(snapshot, activeProjectId, selectedEntityId)
		await sessionRoot.dispatch('syncSelectedClipTrackPosition', { position })
		const summary = createSelectedClipSummaryFromRegistry(snapshot, activeProjectId, selectedEntityId)
		await sessionRoot.dispatch('syncSelectedClipSummary', { summary })
	}

	const syncSessionDerivedState = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		await syncSessionSelectionRels(sessionRoot)
		await syncSessionPreviewAttrs(sessionRoot)
		await syncSessionSelectedClipTrackPosition(sessionRoot)
	}

	const dispatchProjectAction = async (project: MiniCutDktProjectProxyInput, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureProxy(projectProxyNodeIds, project, 'minicut_project', 'sourceProjectId', 'createProjectProxy', project.sourceProjectId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const dispatchTrackAction = async (track: MiniCutDktTrackProxyInput, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureProxy(trackProxyNodeIds, track, 'minicut_track', 'sourceTrackId', 'createTrackProxy', track.sourceTrackId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const dispatchResourceAction = async (resource: MiniCutDktResourceProxyInput, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureProxy(resourceProxyNodeIds, resource, 'minicut_resource', 'sourceResourceId', 'createResourceProxy', resource.sourceResourceId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureClipProxy = async (clip: MiniCutDktClipProxyInput): Promise<string> =>
		ensureProxy(clipProxyNodeIds, clip, 'minicut_clip', 'sourceClipId', 'createClipProxy', clip.sourceClipId)

	const dispatchClipAction = async (clip: MiniCutDktClipProxyInput, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureClipProxy(clip)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureTextProxy = async (text: MiniCutDktTextProxyInput): Promise<string> =>
		ensureProxy(textProxyNodeIds, text, 'minicut_text', 'sourceTextId', 'createTextProxy', text.sourceTextId)

	const dispatchTextAction = async (text: MiniCutDktTextProxyInput, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureTextProxy(text)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureEffectProxy = async (effect: MiniCutDktEffectProxyInput): Promise<string> =>
		ensureProxy(effectProxyNodeIds, effect, 'minicut_effect', 'sourceEffectId', 'createEffectProxy', effect.sourceEffectId)

	const syncEffectProxyAttrs = async (effect: MiniCutDktEffectProxyInput): Promise<string> => {
		const nodeId = await ensureEffectProxy(effect)
		await dispatchAction('setEffectName', { name: effect.name }, nodeId)
		await dispatchAction('setEffectKind', { kind: effect.kind }, nodeId)
		await dispatchAction('setEffectEnabled', { enabled: effect.enabled }, nodeId)
		await dispatchAction('setEffectAmount', { amount: effect.amount }, nodeId)
		await dispatchAction('setEffectParams', { params: effect.params }, nodeId)
		await dispatchAction('setEffectColor', { color: effect.color }, nodeId)
		return nodeId
	}

	const rememberProxyNodeId = async (
		cache: Map<string, string>,
		modelName: string,
		sourceAttrName: string,
		sourceId: string,
	): Promise<string> => {
		const nodeId = await findProxyNodeId(modelName, sourceAttrName, sourceId)
		if (!nodeId) {
			throw new Error(`MiniCut DKT ${modelName} proxy was not created for ${sourceId}`)
		}
		cache.set(sourceId, nodeId)
		return nodeId
	}

	const dispatchEffectAction = async (effect: MiniCutDktEffectProxyInput, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureEffectProxy(effect)
		await dispatchAction(actionName, payload, nodeId)
	}

	const debugDumpAppState = async (): Promise<MiniCutDktDebugState> => {
		const app = await bootstrapApp()
		if (!app) {
			return null
		}

		const lined = await app.appModel.getLinedStructure?.({}, {}) ?? []
		const runtimeModels = Object.values(app.runtime.models ?? {})

		return {
			lined: lined.map(serializeModel),
			runtimeModels: runtimeModels.map(serializeModel),
		}
	}

	const materializeRegistryHierarchy = async (snapshot: ProjectRegistry): Promise<void> => {
		for (const project of Object.values(snapshot.projects)) {
			const projectProxy = toProjectProxy(snapshot, project)
			if (!(await findProxyNodeId('minicut_project', 'sourceProjectId', project.id))) {
				await dispatchAction('createProjectProxy', projectProxy)
				await rememberProxyNodeId(projectProxyNodeIds, 'minicut_project', 'sourceProjectId', project.id)
			}

			await dispatchProjectAction(projectProxy, 'renameProject', { title: projectProxy.title })
			await dispatchProjectAction(projectProxy, 'setProjectFormat', {
				fps: projectProxy.fps,
				width: projectProxy.width,
				height: projectProxy.height,
			})
			await dispatchProjectAction(projectProxy, 'setProjectDuration', { duration: projectProxy.duration })

			const resourceModels: unknown[] = []
			for (const resource of getResourceEntities(snapshot, project)) {
				const resourceProxy = toResourceProxy(resource)
				const resourceNodeId = await ensureProxy(
					resourceProxyNodeIds,
					resourceProxy,
					'minicut_resource',
					'sourceResourceId',
					'createResourceProxy',
					resource.id,
				)
				resourceModels.push(await getProxyModelByNodeId(resourceNodeId))

				await dispatchResourceAction(resourceProxy, 'renameResource', { name: resourceProxy.name })
				await dispatchResourceAction(resourceProxy, 'setResourceStatus', { status: resourceProxy.status })
			}
			await dispatchProjectAction(projectProxy, 'setResources', { resources: resourceModels })

			const trackModels: unknown[] = []
			for (const track of getTracks(snapshot, project)) {
				const trackProxy = toTrackProxy(track)
				const trackNodeId = await ensureProxy(
					trackProxyNodeIds,
					trackProxy,
					'minicut_track',
					'sourceTrackId',
					'createTrackProxy',
					track.id,
				)
				trackModels.push(await getProxyModelByNodeId(trackNodeId))

				await dispatchTrackAction(trackProxy, 'renameTrack', { name: trackProxy.name })
				await dispatchTrackAction(trackProxy, 'setTrackMuted', { muted: trackProxy.muted })
				await dispatchTrackAction(trackProxy, 'setTrackLocked', { locked: trackProxy.locked })

				const clipModels: unknown[] = []
				for (const clip of getClipEntitiesForTrack(snapshot, track.id)) {
					const clipProxy = toClipProxy(clip)
					const textEntity = typeof clip.rels.text === 'string'
						? snapshot.entitiesById[clip.rels.text]
						: null
					const clipNodeId = await ensureClipProxy(clipProxy)
					clipModels.push(await getProxyModelByNodeId(clipNodeId))

					await dispatchClipAction(clipProxy, 'rename', { name: clipProxy.name })
					await dispatchClipAction(clipProxy, 'setTimelineAttrs', {
						start: clipProxy.start,
						in: clipProxy.in,
						duration: clipProxy.duration,
						fadeIn: clipProxy.fadeIn,
						fadeOut: clipProxy.fadeOut,
					})
					if (clipProxy.color) {
						await dispatchClipAction(clipProxy, 'color', { color: clipProxy.color })
					}
					if (clipProxy.opacity?.value != null) {
						await dispatchClipAction(clipProxy, 'updateOpacity', { opacityPercent: clipProxy.opacity.value * 100 })
					}
					if (clipProxy.audio) {
						await dispatchClipAction(clipProxy, 'setAudio', clipProxy.audio)
					}
					if (clipProxy.transform) {
						await dispatchClipAction(clipProxy, 'setTransform', {
							x: clipProxy.transform.x?.value,
							y: clipProxy.transform.y?.value,
							scale: clipProxy.transform.scale?.value,
							rotation: clipProxy.transform.rotation?.value,
						})
					}

					const resourceEntity = typeof clip.rels.resource === 'string'
						? snapshot.entitiesById[clip.rels.resource]
						: null
					if (resourceEntity?.type === 'resource') {
						const resourceProxy = toResourceProxy(resourceEntity)
						const resourceNodeId = await ensureProxy(
							resourceProxyNodeIds,
							resourceProxy,
							'minicut_resource',
							'sourceResourceId',
							'createResourceProxy',
							resourceEntity.id,
						)
						await dispatchClipAction(clipProxy, 'setResource', { resource: await getProxyModelByNodeId(resourceNodeId) })
					} else {
						await dispatchClipAction(clipProxy, 'setResource', { resource: null })
					}

					if (textEntity) {
						const textProxy = toTextProxy(textEntity)
						const textNodeId = await ensureTextProxy(textProxy)
						await dispatchClipAction(clipProxy, 'setText', { text: await getProxyModelByNodeId(textNodeId) })
						await dispatchTextAction(textProxy, 'setTextContent', { content: textProxy.content })
						await dispatchTextAction(textProxy, 'setTextStyle', { style: textProxy.style })
						await dispatchTextAction(textProxy, 'setTextBox', { box: textProxy.box })
					} else {
						await dispatchClipAction(clipProxy, 'setText', { text: null })
					}

					const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
					const effectModels: unknown[] = []
					for (const effectId of effectIds) {
						const effect = snapshot.entitiesById[effectId]
						if (!effect) {
							continue
						}

						const effectProxy = toEffectProxy(effect)
						const effectNodeId = await syncEffectProxyAttrs(effectProxy)
						effectModels.push(await getProxyModelByNodeId(effectNodeId))

						await dispatchEffectAction(effectProxy, 'setEffectName', { name: effectProxy.name })
						await dispatchEffectAction(effectProxy, 'setEffectKind', { kind: effectProxy.kind })
						await dispatchEffectAction(effectProxy, 'setEffectEnabled', { enabled: effectProxy.enabled })
						if (effectProxy.amount != null) {
							await dispatchEffectAction(effectProxy, 'setEffectAmount', { amount: effectProxy.amount })
						}
						if (effectProxy.params) {
							await dispatchEffectAction(effectProxy, 'setEffectParams', { params: effectProxy.params })
						}
						if (effectProxy.color) {
							await dispatchEffectAction(effectProxy, 'setEffectColor', { color: effectProxy.color })
						}
					}
					await dispatchClipAction(clipProxy, 'setEffects', { effects: effectModels })
				}
				await dispatchTrackAction(trackProxy, 'setClips', { clips: clipModels })
			}
			await dispatchProjectAction(projectProxy, 'setTracks', { tracks: trackModels })
		}

		const activeProjectId = snapshot.activeProjectId ?? Object.keys(snapshot.projects)[0] ?? null
		const sessionRoot = await bootstrapSessionRoot()
		if (sessionRoot && sessionRoot.states?.activeProjectId !== activeProjectId) {
			await sessionRoot.dispatch('setActiveProject', activeProjectId)
		}
		if (sessionRoot) {
			await syncSessionDerivedState(sessionRoot)
		}
	}

	const connect = (transport: DomSyncTransportLike<MiniCutDktTransportMessage>) => {
		let destroyed = false
		let stream: ReturnType<typeof createWorkerStream> | null = null
		let activeSessionKey = 'minicut-local'

		const sendError = (error: unknown, requestId?: string): void => {
			transport.send({
				type: DKT_MSG.RUNTIME_ERROR,
				requestId,
				message: error instanceof Error ? error.stack || error.message : String(error),
			})
		}

		const bootstrap = async (requestId?: string, sessionKey?: string): Promise<void> => {
			const app = await bootstrapApp()
			if (!app) {
				throw new Error('MiniCut DKT runtime is disabled')
			}
			activeSessionKey = sessionKey || 'minicut-local'
			const sessionRoot = await bootstrapSessionRoot(activeSessionKey)
			if (!sessionRoot) {
				throw new Error('MiniCut DKT session root is not available')
			}

			if (!stream) {
				stream = createWorkerStream(transport)
				await app.runtime.sync_sender.addSyncStream(sessionRoot, stream, SESSION_IMPORTANT_REL_PATHS)
			}

			transport.send({
				type: DKT_MSG.RUNTIME_READY,
				requestId,
				sessionKey: activeSessionKey,
				rootNodeId: sessionRoot._node_id ?? null,
			})
		}

		const handleMessage = async (message: MiniCutDktTransportMessage): Promise<void> => {
			if (destroyed) {
				return
			}

			switch (message.type) {
				case DKT_MSG.BOOTSTRAP:
					await bootstrap(undefined, message.sessionKey)
					return
				case DKT_MSG.CLOSE_SESSION:
					destroy()
					return
				case DKT_MSG.DISPATCH_ACTION:
					await dispatchScopedAction(message.actionName, message.payload, message.scopeNodeId, activeSessionKey)
					if (!message.scopeNodeId) {
						const sessionRoot = await bootstrapSessionRoot(activeSessionKey)
						if (sessionRoot) {
							await syncSessionDerivedState(sessionRoot)
						}
					}
					if (message.requestId) {
						transport.send({ type: DKT_MSG.RUNTIME_READY, requestId: message.requestId, rootNodeId: null })
					}
					return
				case DKT_MSG.DISPATCH_COMMAND: {
					const result = await dispatchCommand(message.command as Command)
					const sessionRoot = await bootstrapSessionRoot(activeSessionKey)
					if (sessionRoot) {
						await syncSessionDerivedState(sessionRoot)
					}
					transport.send({ type: DKT_MSG.DISPATCH_RESULT, requestId: message.requestId, result })
					transport.send({ type: DKT_MSG.PATCHES, envelope: result.envelope })
					return
				}
				case DKT_MSG.GET_SNAPSHOT:
					transport.send({ type: DKT_MSG.SNAPSHOT, requestId: message.requestId, snapshot: await getRegistrySnapshot() })
					return
				case DKT_MSG.REPLACE_SNAPSHOT:
					await replaceRegistrySnapshot(message.snapshot as ProjectRegistry)
					transport.send({ type: DKT_MSG.SNAPSHOT, requestId: message.requestId, snapshot: await getRegistrySnapshot() })
					return
				case DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE: {
					const app = await bootstrapApp()
					if (!app || !stream) {
						throw new Error('MiniCut DKT sync stream is not bootstrapped')
					}
					app.runtime.sync_sender.updateStructureUsage(stream.id, message.data)
					return
				}
				case DKT_MSG.SYNC_REQUIRE_SHAPE: {
					const app = await bootstrapApp()
					if (!app || !stream) {
						throw new Error('MiniCut DKT sync stream is not bootstrapped')
					}
					app.runtime.sync_sender.requireShapeForModel(stream.id, message.data)
					return
				}
			}
		}

		const unlisten = transport.listen((message) => {
			Promise.resolve(handleMessage(message)).catch((error) => sendError(error, 'requestId' in message ? message.requestId : undefined))
		})

		const destroy = (): void => {
			if (destroyed) {
				return
			}
			destroyed = true
			unlisten()
			void bootstrapApp().then((app) => {
				if (app && stream) {
					app.runtime.sync_sender.removeSyncStream(stream)
				}
			}).finally(() => {
				stream = null
				transport.destroy()
			})
		}

		return { destroy }
	}

	return {
		bootstrapApp,
		bootstrapSessionRoot,
		dispatchAction,
		dispatchSessionAction,
		getRegistrySnapshot,
		replaceRegistrySnapshot,
		dispatchCommand,
		ensureClipProxy,
		dispatchProjectAction,
		dispatchTrackAction,
		dispatchResourceAction,
		dispatchClipAction,
		ensureTextProxy,
		dispatchTextAction,
		ensureEffectProxy,
		dispatchEffectAction,
		connect,
		debugDumpAppState,
	}
}
