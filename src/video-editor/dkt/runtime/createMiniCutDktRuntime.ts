import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import type { DomSyncTransportLike, DomSyncTransportViewLike } from 'dkt/dom-sync/transport.js'
import { _getCurrentRel, _listRels } from 'dkt-all/libs/provoda/_internal/_listRels.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
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

const createWorkerStream = (transport: DomSyncTransportViewLike<MiniCutDktTransportMessage>, sessionKey: string) => ({
	id: `minicut-stream-${Math.random().toString(36).slice(2)}`,
	sessionKey,
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
	tracks?: MiniCutDktTrackSeed[]
	autoCreateDefaultTracks?: boolean
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
	sourceProjectId?: string | null
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


const asString = (value: unknown, fallback: string): string =>
	typeof value === 'string' ? value : fallback

const asNullableString = (value: unknown): string | null =>
	typeof value === 'string' ? value : null

const toModelRef = (model: RuntimeModelLike): string | null =>
	typeof model._node_id === 'string' && model._node_id
		? model._node_id
		: null


const queryModelRel = async (model: RuntimeModelLike, relName: string): Promise<RuntimeModelLike[]> => {
	const queried = await model.queryRel?.(relName)
	return normalizeModelList(queried ?? _getCurrentRel(model, relName))
}

const readInModelInput = async <Value>(model: RuntimeModelLike, read: () => Promise<Value> | Value): Promise<Value> => {
	if (typeof model.input !== 'function') {
		return read()
	}

	return new Promise((resolve, reject) => {
		model.input?.(async () => {
			try {
				resolve(await read())
			} catch (error) {
				reject(error)
			}
		})
	})
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

		await syncSessionSelectionRels(sessionRoot)

		let target = sessionRoot
		if (typeof scopeNodeId === 'string' && scopeNodeId) {
			const scopedTarget = getModelById(sessionRoot, scopeNodeId) as RuntimeModelLike | null
			if (!scopedTarget) {
				throw new Error(`MiniCut DKT scope was not found: ${scopeNodeId}`)
			}

			target = scopedTarget
		}

		await target.dispatch(actionName, payload)
		await syncSessionSelectionRels(sessionRoot)
	}

	const dispatchSessionAction = async (actionName: string, payload?: unknown): Promise<void> => {
		const sessionRoot = await bootstrapSessionRoot()
		if (!sessionRoot) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		await syncSessionSelectionRels(sessionRoot)

		await sessionRoot.dispatch(actionName, payload)
		await syncSessionSelectionRels(sessionRoot)
	}

	// Phase 1 hard rewrite: All registry materialization functions removed.
	// Registry reading/writing belongs in Phase 2 DKT rebuild.
	// Only DKT-native dispatch and session management remain.

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

	const syncOwnershipRels = async (activeProjectModel: RuntimeModelLike): Promise<void> => {
		const projectRef = toModelRef(activeProjectModel)
		if (!projectRef) {
			return
		}
		const resources = await queryModelRel(activeProjectModel, 'resources')
		const resourcesBySourceId = new Map<string, RuntimeModelLike>()
		const resourceToClips = new Map<string, RuntimeModelLike[]>()

		for (const resourceModel of resources) {
			const sourceResourceId = asNullableString(resourceModel.states?.sourceResourceId)
			if (sourceResourceId) {
				resourcesBySourceId.set(sourceResourceId, resourceModel)
				resourceToClips.set(sourceResourceId, [])
			}
			await resourceModel.dispatch('setProject', { project: projectRef })
		}

		const tracks = await queryModelRel(activeProjectModel, 'tracks')
		for (const trackModel of tracks) {
			const trackRef = toModelRef(trackModel)
			if (!trackRef) {
				continue
			}
			const clipModels = await queryModelRel(trackModel, 'clips')
			for (const clipModel of clipModels) {
				const clipRef = toModelRef(clipModel)
				if (!clipRef) {
					continue
				}
				await clipModel.dispatch('setTrack', { track: trackRef })
				await clipModel.dispatch('setProject', { project: projectRef })

				const sourceResourceId = asNullableString(clipModel.states?.sourceResourceId)
				if (sourceResourceId) {
					const resourceModel = resourcesBySourceId.get(sourceResourceId) ?? null
					if (resourceModel) {
						const resourceRef = toModelRef(resourceModel)
						if (resourceRef) {
							await clipModel.dispatch('setResource', { resource: resourceRef })
						}
						const clips = resourceToClips.get(sourceResourceId)
						if (clips) {
							clips.push(clipModel)
						}
					}
				}

				const sourceTextId = asNullableString(clipModel.states?.sourceTextId)
				if (sourceTextId) {
					const textModel = await findSeededModelBySourceId('minicut_text', 'sourceTextId', sourceTextId)
					if (isRuntimeModelLike(textModel)) {
						const textRef = toModelRef(textModel)
						if (textRef) {
							await clipModel.dispatch('setText', { text: textRef })
						}
						await textModel.dispatch('setClip', { clip: clipRef })
					}
				}

				const effectModels = await queryModelRel(clipModel, 'effects')
				for (const effectModel of effectModels) {
					await effectModel.dispatch('setEffectClip', { clip: clipRef })
					await effectModel.dispatch('setEffectProject', { project: projectRef })
				}
			}
		}

		for (const [sourceResourceId, resourceModel] of resourcesBySourceId.entries()) {
			const clipRefs = (resourceToClips.get(sourceResourceId) ?? [])
				.map(toModelRef)
				.filter((item): item is string => typeof item === 'string')
			await resourceModel.dispatch('setClips', {
				clips: clipRefs,
			})
		}
	}

	// Phase 1: Removed syncSessionDerivedState - registry materialization belongs in Phase 2 DKT rebuild
	const syncSessionSelectionRels = async (sessionRoot: RuntimeModelLike): Promise<void> => {
		const activeProjectId = typeof sessionRoot.states?.activeProjectId === 'string'
			? sessionRoot.states.activeProjectId
			: null
		const selectedEntityId = typeof sessionRoot.states?.selectedEntityId === 'string'
			? sessionRoot.states.selectedEntityId
			: null

		const activeProjectFromRel = (await queryModelRel(sessionRoot, 'activeProject'))[0] ?? null
		let activeProject = activeProjectFromRel
			?? await findSeededModelBySourceId('minicut_project', 'sourceProjectId', activeProjectId)

		if (!isRuntimeModelLike(activeProject) && activeProjectId) {
			const pioneer = (await queryModelRel(sessionRoot, 'pioneer'))[0] ?? null
			if (isRuntimeModelLike(pioneer)) {
				const projects = await queryModelRel(pioneer, 'project')
				for (const project of projects) {
					const sourceProjectId = asNullableString(project.states?.sourceProjectId)
					if (sourceProjectId === activeProjectId) {
						activeProject = project
						break
					}
				}
			}
		}
		await sessionRoot.dispatch('syncActiveProjectRel', { project: activeProject })

		const activeProjectModel = isRuntimeModelLike(activeProject) ? activeProject : null
		if (!activeProjectModel) {
			await sessionRoot.dispatch('syncSelectedClipRel', { clip: null })
			await sessionRoot.dispatch('syncSelectedClipSummary', { summary: null })
			await sessionRoot.dispatch('syncSelectedClipTrackPosition', { position: null })
			return
		}

		await syncOwnershipRels(activeProjectModel)

		// Find selected clip — minimal traversal (tracks → clips only, breaks early on match)
		// previewStructure is now a DKT comp attr; no clipSources building needed here
		let selectedClipModel: RuntimeModelLike | null = null
		let selectedClipSummary: Record<string, unknown> | null = null
		let selectedClipTrackPosition: Record<string, unknown> | null = null

		if (selectedEntityId) {
			const tracks = await queryModelRel(activeProjectModel, 'tracks')
			outer: for (const [trackIndex, trackModel] of tracks.entries()) {
				const trackName = asString(trackModel.states?.name, `Track ${trackIndex + 1}`)
				const clipModels = await queryModelRel(trackModel, 'clips')
				for (const clipModel of clipModels) {
					const clipAttrs = clipModel.states ?? {}
					const sourceClipId = asNullableString(clipAttrs.sourceClipId)
					if (sourceClipId === selectedEntityId) {
						selectedClipModel = clipModel
						selectedClipSummary = {
							color: asString(clipAttrs.color, '#2563eb'),
							resourceName: asString(clipAttrs.name, 'Clip'),
							trackName,
						}
						selectedClipTrackPosition = { trackName, ordinal: trackIndex + 1 }
						break outer
					}
				}
			}
			if (!selectedClipModel) {
				const fallbackClip = await findSeededModelBySourceId('minicut_clip', 'sourceClipId', selectedEntityId)
				if (isRuntimeModelLike(fallbackClip)) {
					const clipAttrs = fallbackClip.states ?? {}
					selectedClipModel = fallbackClip
					selectedClipSummary = {
						color: asString(clipAttrs.color, '#2563eb'),
						resourceName: asString(clipAttrs.name, 'Clip'),
						trackName: 'Track',
					}
				}
			}
		}

		await sessionRoot.dispatch('syncSelectedClipRel', { clip: selectedClipModel })
		await sessionRoot.dispatch('syncSelectedClipSummary', { summary: selectedClipSummary })
		await sessionRoot.dispatch('syncSelectedClipTrackPosition', { position: selectedClipTrackPosition })
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

			// Recreate the sync stream if the sessionKey changed (e.g. after failover reconnect
			// or if a premature BOOTSTRAP previously locked the stream to the wrong session).
			if (stream && stream.sessionKey !== activeSessionKey) {
				app.runtime.sync_sender.removeSyncStream(stream)
				stream = null
			}
			if (!stream) {
				stream = createWorkerStream(transport, activeSessionKey)
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
					if (message.requestId) {
						transport.send({ type: DKT_MSG.RUNTIME_READY, requestId: message.requestId, rootNodeId: null })
					}
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
