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

	const findClipProxyNodeId = async (sourceClipId: string): Promise<string | null> => {
		return findProxyNodeId('minicut_clip', 'sourceClipId', sourceClipId)
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

	const waitForClipProxyNodeId = async (sourceClipId: string): Promise<string | null> => {
		for (let attempt = 0; attempt < 20; attempt++) {
			const nodeId = await findClipProxyNodeId(sourceClipId)
			if (nodeId) {
				return nodeId
			}
			await new Promise((resolve) => setTimeout(resolve, 0))
		}

		return findClipProxyNodeId(sourceClipId)
	}

	const ensureClipProxy = async (clip: MiniCutDktClipProxyInput): Promise<string> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		const cachedNodeId = clipProxyNodeIds.get(clip.sourceClipId)
		if (cachedNodeId && getModelById(app.appModel, cachedNodeId)) {
			return cachedNodeId
		}

		const existingNodeId = await findClipProxyNodeId(clip.sourceClipId)
		if (existingNodeId) {
			clipProxyNodeIds.set(clip.sourceClipId, existingNodeId)
			return existingNodeId
		}

		await app.appModel.dispatch('createClipProxy', clip)
		const createdNodeId = await waitForClipProxyNodeId(clip.sourceClipId)
		if (!createdNodeId) {
			throw new Error(`MiniCut DKT clip proxy was not created for ${clip.sourceClipId}`)
		}

		clipProxyNodeIds.set(clip.sourceClipId, createdNodeId)
		return createdNodeId
	}

	const dispatchClipAction = async (
		clip: MiniCutDktClipProxyInput,
		actionName: string,
		payload?: unknown,
	): Promise<void> => {
		const nodeId = await ensureClipProxy(clip)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureTextProxy = async (text: MiniCutDktTextProxyInput): Promise<string> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		const cachedNodeId = textProxyNodeIds.get(text.sourceTextId)
		if (cachedNodeId && getModelById(app.appModel, cachedNodeId)) {
			return cachedNodeId
		}

		const existingNodeId = await findProxyNodeId('minicut_text', 'sourceTextId', text.sourceTextId)
		if (existingNodeId) {
			textProxyNodeIds.set(text.sourceTextId, existingNodeId)
			return existingNodeId
		}

		await app.appModel.dispatch('createTextProxy', text)
		const createdNodeId = await waitForProxyNodeId('minicut_text', 'sourceTextId', text.sourceTextId)
		if (!createdNodeId) {
			throw new Error(`MiniCut DKT text proxy was not created for ${text.sourceTextId}`)
		}

		textProxyNodeIds.set(text.sourceTextId, createdNodeId)
		return createdNodeId
	}

	const dispatchTextAction = async (
		text: MiniCutDktTextProxyInput,
		actionName: string,
		payload?: unknown,
	): Promise<void> => {
		const nodeId = await ensureTextProxy(text)
		await dispatchAction(actionName, payload, nodeId)
	}

	const ensureEffectProxy = async (effect: MiniCutDktEffectProxyInput): Promise<string> => {
		const app = await bootstrapApp()
		if (!app) {
			throw new Error('MiniCut DKT runtime is disabled')
		}

		const cachedNodeId = effectProxyNodeIds.get(effect.sourceEffectId)
		if (cachedNodeId && getModelById(app.appModel, cachedNodeId)) {
			return cachedNodeId
		}

		const existingNodeId = await findProxyNodeId('minicut_effect', 'sourceEffectId', effect.sourceEffectId)
		if (existingNodeId) {
			effectProxyNodeIds.set(effect.sourceEffectId, existingNodeId)
			return existingNodeId
		}

		await app.appModel.dispatch('createEffectProxy', effect)
		const createdNodeId = await waitForProxyNodeId('minicut_effect', 'sourceEffectId', effect.sourceEffectId)
		if (!createdNodeId) {
			throw new Error(`MiniCut DKT effect proxy was not created for ${effect.sourceEffectId}`)
		}

		effectProxyNodeIds.set(effect.sourceEffectId, createdNodeId)
		return createdNodeId
	}

	const dispatchEffectAction = async (
		effect: MiniCutDktEffectProxyInput,
		actionName: string,
		payload?: unknown,
	): Promise<void> => {
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

	return {
		bootstrapApp,
		bootstrapSessionRoot,
		dispatchAction,
		dispatchSessionAction,
		ensureClipProxy,
		dispatchClipAction,
		ensureTextProxy,
		dispatchTextAction,
		ensureEffectProxy,
		dispatchEffectAction,
		debugDumpAppState,
	}
}
