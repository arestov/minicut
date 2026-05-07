/**
 * Test-only utilities for exercising the MiniCut DKT runtime directly.
 *
 * Import from this file in tests — NOT from createMiniCutDktRuntime.ts.
 * createMiniCutDktRuntime.ts is a production-only file that exposes only `connect`.
 */
import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import { _getCurrentRel, _listRels } from 'dkt-all/libs/provoda/_internal/_listRels.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
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
	models?: Record<string, RuntimeModelLike>
}

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
		model.input?.(async () => {
			try {
				resolve(await read())
			} catch (error) {
				reject(error)
			}
		})
	})
}

export const createMiniCutDktTestRuntime = (options: { enabled?: boolean } = {}) => {
	let bootPromise: Promise<{ runtime: RuntimeLike; appModel: RuntimeModelLike }> | null = null
	const sessionRootPromises = new Map<string, Promise<RuntimeModelLike>>()
	const clipNodeIdsBySourceId = new Map<string, string>()
	const projectNodeIdsBySourceId = new Map<string, string>()
	const trackNodeIdsBySourceId = new Map<string, string>()
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

	const dispatchSessionAction = async (actionName: string, payload?: unknown): Promise<void> => {
		const sessionRoot = await bootstrapSessionRoot()
		if (!sessionRoot) {
			throw new Error('MiniCut DKT runtime is disabled')
		}
		await sessionRoot.dispatch(actionName, payload)
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

	const dispatchProjectAction = async (project: MiniCutDktProjectSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureSeededModel(projectNodeIdsBySourceId, project, 'minicut_project', 'sourceProjectId', 'createProjectModel', project.sourceProjectId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const dispatchTrackAction = async (track: MiniCutDktTrackSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureSeededModel(trackNodeIdsBySourceId, track, 'minicut_track', 'sourceTrackId', 'createTrackModel', track.sourceTrackId)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureClipSeed = async (clip: MiniCutDktClipSeed): Promise<string> =>
		ensureSeededModel(clipNodeIdsBySourceId, clip, 'minicut_clip', 'sourceClipId', 'createClipModel', clip.sourceClipId)

	const dispatchClipAction = async (clip: MiniCutDktClipSeed, actionName: string, payload?: unknown): Promise<void> => {
		const nodeId = await ensureClipSeed(clip)
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

	return {
		bootstrapApp,
		bootstrapSessionRoot,
		dispatchAction,
		dispatchSessionAction,
		ensureClipSeed,
		dispatchProjectAction,
		dispatchTrackAction,
		dispatchClipAction,
		debugDumpAppState,
	}
}
