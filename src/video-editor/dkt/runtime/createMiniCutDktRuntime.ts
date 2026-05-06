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

export type MiniCutDktProjectSeed = {
	sourceProjectId: string
	title?: string
	fps?: number
	width?: number
	height?: number
	duration?: number
	createdAt?: number
	updatedAt?: number
}

export type MiniCutDktTrackSeed = {
	sourceTrackId: string
	kind?: 'video' | 'audio'
	name?: string
	muted?: boolean
	locked?: boolean
	height?: number
}

export type MiniCutDktResourceSeed = {
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

export type MiniCutDktClipSeed = {
	sourceClipId: string
	sourceResourceId?: string | null
	sourceTextId?: string | null
	name?: string
	color?: string
	mediaKind?: string
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

export type MiniCutDktTextSeed = {
	sourceTextId: string
	content?: string
	style?: Record<string, unknown>
	box?: Record<string, unknown>
}

export type MiniCutDktEffectSeed = {
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

const toProjectSeed = (snapshot: ProjectRegistry, project: ProjectGraph): MiniCutDktProjectSeed => {
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

const toTrackSeed = (track: { id: string; attrs: Record<string, unknown> }): MiniCutDktTrackSeed => {
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

const toResourceSeed = (resource: { id: string; attrs: Record<string, unknown> }): MiniCutDktResourceSeed => {
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

const toClipSeed = (clip: { id: string; attrs: Record<string, unknown>; rels: Record<string, unknown> }): MiniCutDktClipSeed => {
	const attrs = asClipAttrs(clip.attrs)
	return {
		sourceClipId: clip.id,
		sourceResourceId: typeof clip.rels.resource === 'string' ? clip.rels.resource : null,
		sourceTextId: typeof clip.rels.text === 'string' ? clip.rels.text : null,
		name: attrs.name,
		color: attrs.color,
		mediaKind: attrs.mediaKind,
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

const toTextSeed = (text: { id: string; attrs: Record<string, unknown> }): MiniCutDktTextSeed => {
	const attrs = asTextAttrs(text.attrs)
	return {
		sourceTextId: text.id,
		content: attrs.content,
		style: attrs.style,
		box: attrs.box,
	}
}

const toEffectSeed = (effect: { id: string; attrs: Record<string, unknown> }): MiniCutDktEffectSeed => {
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
	const clipNodeIdsBySourceId = new Map<string, string>()
	const projectNodeIdsBySourceId = new Map<string, string>()
	const trackNodeIdsBySourceId = new Map<string, string>()
	const resourceNodeIdsBySourceId = new Map<string, string>()
	const textNodeIdsBySourceId = new Map<string, string>()
	const effectNodeIdsBySourceId = new Map<string, string>()
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
	): Promise<void> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		let target = app.appModel
		if (typeof scopeNodeId === 'string' && scopeNodeId) {
			target = (getModelById(app.appModel, scopeNodeId) as RuntimeModelLike | null) ?? target
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

	const findModelNodeIdBySourceId = async (modelName: string, sourceAttrName: string, sourceId: string): Promise<string | null> => {
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

	const ensureSeededModel = async (
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

		const existingNodeId = await findModelNodeIdBySourceId(modelName, sourceAttrName, sourceId)
		if (existingNodeId) {
			cache.set(sourceId, existingNodeId)
			return existingNodeId
		}

		await app.appModel.dispatch(createActionName, input)
		const createdNodeId = await findModelNodeIdBySourceId(modelName, sourceAttrName, sourceId)
		if (!createdNodeId) {
			throw new Error(`MiniCut DKT ${modelName} model was not created for ${sourceId}`)
		}

		cache.set(sourceId, createdNodeId)
		return createdNodeId
	}

	const getSeededModelByNodeId = async (nodeId: string): Promise<unknown> => {
		const app = await bootstrapApp()
		const model = app ? getModelById(app.appModel, nodeId) : null
		if (!model) {
			throw new Error(`MiniCut DKT model is not available for ${nodeId}`)
		}
		return model
	}

	const findSeededModelBySourceId = async (modelName: string, sourceAttrName: string, sourceId: string | null): Promise<unknown | null> => {
		if (!sourceId) {
			return null
		}

		const nodeId = await findModelNodeIdBySourceId(modelName, sourceAttrName, sourceId)
		return nodeId ? getSeededModelByNodeId(nodeId) : null
	}

	const syncSessionSelectionRels = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		const activeProjectId = typeof sessionRoot.states?.activeProjectId === 'string'
			? sessionRoot.states.activeProjectId
			: null
		const selectedEntityId = typeof sessionRoot.states?.selectedEntityId === 'string'
			? sessionRoot.states.selectedEntityId
			: null

		const activeProject = await findSeededModelBySourceId('minicut_project', 'sourceProjectId', activeProjectId)
		const selectedClip = await findSeededModelBySourceId('minicut_clip', 'sourceClipId', selectedEntityId)
		await sessionRoot.dispatch('syncActiveProjectRel', { project: activeProject })
		await sessionRoot.dispatch('syncSelectedClipRel', { clip: selectedClip })
	}

	const syncSessionDerivedState = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		await syncSessionSelectionRels(sessionRoot)
	}

	const dispatchProjectAction = async (project: MiniCutDktProjectSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureSeededModel(projectNodeIdsBySourceId, project, 'minicut_project', 'sourceProjectId', 'createProjectModel', project.sourceProjectId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const dispatchTrackAction = async (track: MiniCutDktTrackSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureSeededModel(trackNodeIdsBySourceId, track, 'minicut_track', 'sourceTrackId', 'createTrackModel', track.sourceTrackId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const dispatchResourceAction = async (resource: MiniCutDktResourceSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureSeededModel(resourceNodeIdsBySourceId, resource, 'minicut_resource', 'sourceResourceId', 'createResourceModel', resource.sourceResourceId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureClipSeed = async (clip: MiniCutDktClipSeed): Promise<string> =>
		ensureSeededModel(clipNodeIdsBySourceId, clip, 'minicut_clip', 'sourceClipId', 'createClipModel', clip.sourceClipId)

	const dispatchClipAction = async (clip: MiniCutDktClipSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureClipSeed(clip)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureTextSeed = async (text: MiniCutDktTextSeed): Promise<string> =>
		ensureSeededModel(textNodeIdsBySourceId, text, 'minicut_text', 'sourceTextId', 'createTextModel', text.sourceTextId)

	const dispatchTextAction = async (text: MiniCutDktTextSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureTextSeed(text)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureEffectSeed = async (effect: MiniCutDktEffectSeed): Promise<string> =>
		ensureSeededModel(effectNodeIdsBySourceId, effect, 'minicut_effect', 'sourceEffectId', 'createEffectModel', effect.sourceEffectId)

	const syncEffectSeedAttrs = async (effect: MiniCutDktEffectSeed): Promise<string> => {
		const nodeId = await ensureEffectSeed(effect)
		await dispatchAction('setEffectName', { name: effect.name }, nodeId)
		await dispatchAction('setEffectKind', { kind: effect.kind }, nodeId)
		await dispatchAction('setEffectEnabled', { enabled: effect.enabled }, nodeId)
		await dispatchAction('setEffectAmount', { amount: effect.amount }, nodeId)
		await dispatchAction('setEffectParams', { params: effect.params }, nodeId)
		await dispatchAction('setEffectColor', { color: effect.color }, nodeId)
		return nodeId
	}

	const rememberModelNodeId = async (
		cache: Map<string, string>,
		modelName: string,
		sourceAttrName: string,
		sourceId: string,
	): Promise<string> => {
		const nodeId = await findModelNodeIdBySourceId(modelName, sourceAttrName, sourceId)
		if (!nodeId) {
			throw new Error(`MiniCut DKT ${modelName} model was not created for ${sourceId}`)
		}
		cache.set(sourceId, nodeId)
		return nodeId
	}

	const dispatchEffectAction = async (effect: MiniCutDktEffectSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureEffectSeed(effect)
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
			const projectSeed = toProjectSeed(snapshot, project)
			if (!(await findModelNodeIdBySourceId('minicut_project', 'sourceProjectId', project.id))) {
				await dispatchAction('createProjectModel', projectSeed)
				await rememberModelNodeId(projectNodeIdsBySourceId, 'minicut_project', 'sourceProjectId', project.id)
			}

			await dispatchProjectAction(projectSeed, 'renameProject', { title: projectSeed.title })
			await dispatchProjectAction(projectSeed, 'setProjectFormat', {
				fps: projectSeed.fps,
				width: projectSeed.width,
				height: projectSeed.height,
			})
			await dispatchProjectAction(projectSeed, 'setProjectDuration', { duration: projectSeed.duration })

			const resourceModels: unknown[] = []
			for (const resource of getResourceEntities(snapshot, project)) {
				const resourceSeed = toResourceSeed(resource)
				const resourceNodeId = await ensureSeededModel(
					resourceNodeIdsBySourceId,
					resourceSeed,
					'minicut_resource',
					'sourceResourceId',
					'createResourceModel',
					resource.id,
				)
				await dispatchResourceAction(resourceSeed, 'setResourceAttrs', resourceSeed)
				resourceModels.push(await getSeededModelByNodeId(resourceNodeId))
			}
			await dispatchProjectAction(projectSeed, 'setResources', { resources: resourceModels })

			const trackModels: unknown[] = []
			for (const track of getTracks(snapshot, project)) {
				const trackSeed = toTrackSeed(track)
				const trackNodeId = await ensureSeededModel(
					trackNodeIdsBySourceId,
					trackSeed,
					'minicut_track',
					'sourceTrackId',
					'createTrackModel',
					track.id,
				)

				await dispatchTrackAction(trackSeed, 'renameTrack', { name: trackSeed.name })
				await dispatchTrackAction(trackSeed, 'setTrackMuted', { muted: trackSeed.muted })
				await dispatchTrackAction(trackSeed, 'setTrackLocked', { locked: trackSeed.locked })

				const clipModels: unknown[] = []
				for (const clip of getClipEntitiesForTrack(snapshot, track.id)) {
					const clipSeed = toClipSeed(clip)
					const textEntity = typeof clip.rels.text === 'string'
						? snapshot.entitiesById[clip.rels.text]
						: null
					const clipNodeId = await ensureClipSeed(clipSeed)

					await dispatchClipAction(clipSeed, 'setClipAttrs', clipSeed)
					await dispatchClipAction(clipSeed, 'setTimelineAttrs', {
						start: clipSeed.start,
						in: clipSeed.in,
						duration: clipSeed.duration,
						fadeIn: clipSeed.fadeIn,
						fadeOut: clipSeed.fadeOut,
					})
					if (clipSeed.color) {
						await dispatchClipAction(clipSeed, 'color', { color: clipSeed.color })
					}
					if (clipSeed.opacity?.value != null) {
						await dispatchClipAction(clipSeed, 'updateOpacity', { opacityPercent: clipSeed.opacity.value * 100 })
					}
					if (clipSeed.audio) {
						await dispatchClipAction(clipSeed, 'setAudio', clipSeed.audio)
					}
					if (clipSeed.transform) {
						await dispatchClipAction(clipSeed, 'setTransform', {
							x: clipSeed.transform.x?.value,
							y: clipSeed.transform.y?.value,
							scale: clipSeed.transform.scale?.value,
							rotation: clipSeed.transform.rotation?.value,
						})
					}

					const resourceEntity = typeof clip.rels.resource === 'string'
						? snapshot.entitiesById[clip.rels.resource]
						: null
					if (resourceEntity?.type === 'resource') {
						const resourceSeed = toResourceSeed(resourceEntity)
						const resourceNodeId = await ensureSeededModel(
							resourceNodeIdsBySourceId,
							resourceSeed,
							'minicut_resource',
							'sourceResourceId',
							'createResourceModel',
							resourceEntity.id,
						)
						await dispatchClipAction(clipSeed, 'setResource', { resource: await getSeededModelByNodeId(resourceNodeId) })
					} else {
						await dispatchClipAction(clipSeed, 'setResource', { resource: null })
					}

					if (textEntity) {
						const textSeed = toTextSeed(textEntity)
						const textNodeId = await ensureTextSeed(textSeed)
						await dispatchClipAction(clipSeed, 'setText', { text: await getSeededModelByNodeId(textNodeId) })
						await dispatchTextAction(textSeed, 'setTextContent', { content: textSeed.content })
						await dispatchTextAction(textSeed, 'setTextStyle', { style: textSeed.style })
						await dispatchTextAction(textSeed, 'setTextBox', { box: textSeed.box })
					} else {
						await dispatchClipAction(clipSeed, 'setText', { text: null })
					}

					const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
					const effectModels: unknown[] = []
					for (const effectId of effectIds) {
						const effect = snapshot.entitiesById[effectId]
						if (!effect) {
							continue
						}

						const effectSeed = toEffectSeed(effect)
						const effectNodeId = await syncEffectSeedAttrs(effectSeed)
						effectModels.push(await getSeededModelByNodeId(effectNodeId))

						await dispatchEffectAction(effectSeed, 'setEffectName', { name: effectSeed.name })
						await dispatchEffectAction(effectSeed, 'setEffectKind', { kind: effectSeed.kind })
						await dispatchEffectAction(effectSeed, 'setEffectEnabled', { enabled: effectSeed.enabled })
						if (effectSeed.amount != null) {
							await dispatchEffectAction(effectSeed, 'setEffectAmount', { amount: effectSeed.amount })
						}
						if (effectSeed.params) {
							await dispatchEffectAction(effectSeed, 'setEffectParams', { params: effectSeed.params })
						}
						if (effectSeed.color) {
							await dispatchEffectAction(effectSeed, 'setEffectColor', { color: effectSeed.color })
						}
					}
					await dispatchClipAction(clipSeed, 'setEffects', { effects: effectModels })
					clipModels.push(await getSeededModelByNodeId(clipNodeId))
				}
				await dispatchTrackAction(trackSeed, 'setClips', { clips: clipModels })
				trackModels.push(await getSeededModelByNodeId(trackNodeId))
			}
			await dispatchProjectAction(projectSeed, 'setTracks', { tracks: trackModels })
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
		ensureClipSeed,
		dispatchProjectAction,
		dispatchTrackAction,
		dispatchResourceAction,
		dispatchClipAction,
		ensureTextSeed,
		dispatchTextAction,
		ensureEffectSeed,
		dispatchEffectAction,
		connect,
		debugDumpAppState,
	}
}
