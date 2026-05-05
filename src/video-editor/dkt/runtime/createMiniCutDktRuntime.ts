import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import type { DomSyncTransportLike, DomSyncTransportViewLike } from 'dkt/dom-sync/transport.js'
import { _getCurrentRel, _listRels } from 'dkt-all/libs/provoda/_internal/_listRels.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
import { buildDispatchResult } from '../../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../../domain/applyPatch'
import type { Command, DispatchResult, ProjectRegistry } from '../../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'
import { MiniCutAppRoot } from '../../models/AppRoot'

type RuntimeModelLike = {
	_node_id?: string | null
	model_name?: string | null
	states?: Record<string, unknown>
	__getPublicAttrs?: () => readonly string[]
	getLinedStructure?: (options: unknown, config: unknown) => Promise<readonly RuntimeModelLike[]> | readonly RuntimeModelLike[]
	input?: (callback: () => void | Promise<void>) => unknown
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

export const createMiniCutDktRuntime = (options: { enabled?: boolean } = {}) => {
	let bootPromise: Promise<{ runtime: RuntimeLike; appModel: RuntimeModelLike }> | null = null
	let sessionRootPromise: Promise<RuntimeModelLike> | null = null
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

		if (!sessionRootPromise) {
			sessionRootPromise = new Promise((resolve, reject) => {
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
		}

		return sessionRootPromise
	}

	const dispatchAction = async (actionName: string, payload?: unknown, scopeNodeId?: string | null): Promise<void> => {
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

	const dispatchSessionAction = async (actionName: string, payload?: unknown): Promise<void> => {
		const sessionRoot = await bootstrapSessionRoot()
		if (!sessionRoot) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		await sessionRoot.dispatch(actionName, payload)
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
	}

	const dispatchCommand = async (command: Command): Promise<DispatchResult> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		const registry = structuredClone(app.appModel.states?.registrySnapshot as ProjectRegistry)
		const result = buildDispatchResult(registry, command)
		await app.appModel.dispatch('replaceRegistrySnapshot', applyPatchEnvelopeToRegistry(registry, result.envelope))
		return structuredClone(result)
	}

	const findProxyNodeId = async (modelName: string, sourceAttrName: string, sourceId: string): Promise<string | null> => {
		const state = await debugDumpAppState()
		const models = [
			...(state?.runtimeModels ?? []),
			...(state?.lined ?? []),
		]
		const match = models.find((model) => (
			model.modelName === modelName
			&& model.attrs[sourceAttrName] === sourceId
			&& typeof model.nodeId === 'string'
		))

		return match?.nodeId ?? null
	}

	const waitForProxyNodeId = async (modelName: string, sourceAttrName: string, sourceId: string): Promise<string | null> => {
		for (let attempt = 0; attempt < 20; attempt++) {
			const nodeId = await findProxyNodeId(modelName, sourceAttrName, sourceId)
			if (nodeId) {
				return nodeId
			}
			await new Promise((resolve) => setTimeout(resolve, 0))
		}

		return findProxyNodeId(modelName, sourceAttrName, sourceId)
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
		const createdNodeId = await waitForProxyNodeId(modelName, sourceAttrName, sourceId)
		if (!createdNodeId) {
			throw new Error(`MiniCut DKT ${modelName} proxy was not created for ${sourceId}`)
		}

		cache.set(sourceId, createdNodeId)
		return createdNodeId
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

	const connect = (transport: DomSyncTransportLike<MiniCutDktTransportMessage>) => {
		let destroyed = false
		let stream: ReturnType<typeof createWorkerStream> | null = null

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

			if (!stream) {
				stream = createWorkerStream(transport)
				await app.runtime.sync_sender.addSyncStream(app.appModel, stream, [])
			}

			if (sessionKey) {
				await bootstrapSessionRoot(sessionKey)
			}

			transport.send({
				type: DKT_MSG.RUNTIME_READY,
				requestId,
				sessionKey,
				rootNodeId: app.appModel._node_id ?? null,
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
					await dispatchAction(message.actionName, message.payload, message.scopeNodeId)
					if (message.requestId) {
						transport.send({ type: DKT_MSG.RUNTIME_READY, requestId: message.requestId, rootNodeId: null })
					}
					return
				case DKT_MSG.DISPATCH_COMMAND: {
					const result = await dispatchCommand(message.command as Command)
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
