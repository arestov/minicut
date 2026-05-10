import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import type { DomSyncTransportLike, DomSyncTransportViewLike } from 'dkt/dom-sync/transport.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'
import { MiniCutAppRoot } from '../../models/AppRoot'
import { dumpWorkerAppState } from './workerStateDump'

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
	whenAllReady?: (fn: () => void) => void
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

export const createMiniCutDktRuntime = (options: { enabled?: boolean } = {}) => {
	let bootPromise: Promise<{ runtime: RuntimeLike; appModel: RuntimeModelLike }> | null = null
	const sessionRootPromises = new Map<string, Promise<RuntimeModelLike>>()
	const activeTransports = new Set<DomSyncTransportLike<MiniCutDktTransportMessage>>()
	const enabled = options.enabled === true

	const logRuntime = (message: string, details?: unknown) => {
		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.RUNTIME_LOG,
				message: { channel: 'export-request', message, details },
			})
		}
		if ((globalThis as { __MINICUT_EXPORT_DEBUG__?: unknown }).__MINICUT_EXPORT_DEBUG__ === true) {
			console.info('[minicut:dkt-worker:export]', message, details)
		}
	}

	const publishExportRequest = (payload: unknown) => {
		const requestPayload = payload && typeof payload === 'object'
			? ((payload as { request?: unknown }).request ?? payload)
			: payload
		const requestId = (requestPayload as { id?: unknown } | null)?.id
		logRuntime('publishExportRequest:attempt', {
			requestId,
			transports: activeTransports.size,
		})

		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.EXPORT_REQUEST,
				payload,
			})
		}
		logRuntime('publishExportRequest:sent', {
			requestId,
			transports: activeTransports.size,
		})
	}

	const publishImportFilesRequest = (payload: unknown) => {
		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.IMPORT_FILES_REQUEST,
				payload,
			})
		}
	}

	const clearExportProgressInAllSessions = async () => {
		logRuntime('clearExportProgressInAllSessions:start', { sessionCount: sessionRootPromises.size })
		for (const [sessionKey, sessionRootPromise] of sessionRootPromises) {
			try {
				await dispatchScopedAction('clearExportProgress', {}, null, sessionKey)
				logRuntime('clearExportProgressInAllSessions:cleared', { sessionKey })
			} catch (error) {
				logRuntime('clearExportProgressInAllSessions:error', { sessionKey, error: String(error) })
			}
		}
	}

	const bootstrapApp = async () => {
		if (!enabled) {
			return null
		}

		if (!bootPromise) {
			bootPromise = (async () => {
				const runtime = prepareAppRuntime({
					sync_sender: true,
					warnUnexpectedAttrs: true,
					onError(error: unknown) {
						for (const transport of activeTransports) {
							transport.send({
								type: DKT_MSG.RUNTIME_ERROR,
								message: error instanceof Error ? error.stack || error.message : String(error),
							})
						}
					},
				}) as RuntimeLike
				const inited = await runtime.start({
					App: MiniCutAppRoot,
					interfaces: {
						time: {
							setTimeout: globalThis.setTimeout.bind(globalThis),
							clearTimeout: globalThis.clearTimeout.bind(globalThis),
							Date: globalThis.Date,
						},
						exportRuntime: {
							requestExport: (payload: unknown) => {
								const requestPayload = payload && typeof payload === 'object'
									? ((payload as { request?: unknown }).request ?? payload)
									: payload
								logRuntime('exportRuntime.requestExport', {
									requestId: (requestPayload as { id?: unknown } | null)?.id,
								})
								publishExportRequest(payload)
							},
						},
						importRuntime: {
							requestImportFiles: (payload: unknown) => {
								publishImportFilesRequest(payload)
							},
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
	}

	const connect = (transport: DomSyncTransportLike<MiniCutDktTransportMessage>) => {
		let destroyed = false
		let stream: ReturnType<typeof createWorkerStream> | null = null
		let activeSessionKey = 'minicut-local'
		let messageQueue = Promise.resolve()
		activeTransports.add(transport)

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
				case DKT_MSG.WAIT_IDLE: {
					const app = await bootstrapApp()
					if (!app) {
						transport.send({ type: DKT_MSG.IDLE, requestId: message.requestId })
						return
					}

					await new Promise<void>((resolve) => {
						if (typeof app.runtime.whenAllReady === 'function') {
							app.runtime.whenAllReady(() => resolve())
							return
						}

						if (typeof app.appModel.input === 'function') {
							app.appModel.input?.(() => resolve())
							return
						}

						resolve()
					})

					transport.send({ type: DKT_MSG.IDLE, requestId: message.requestId })
					return
				}
				case DKT_MSG.CLOSE_SESSION:
					destroy()
					return
				case DKT_MSG.DISPATCH_ACTION:
					if (
						message.actionName === 'requestProjectExport'
						|| message.actionName === 'requestSelectedClipExport'
						|| message.actionName === 'requestClipExport'
					) {
						logRuntime('dispatch export action', {
							actionName: message.actionName,
							requestId: (message.payload as { id?: unknown } | null)?.id,
							scopeNodeId: message.scopeNodeId ?? null,
						})
					}
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
				case DKT_MSG.DEBUG_DUMP_REQUEST: {
					const app = await bootstrapApp()
					if (!app) {
						transport.send({ type: DKT_MSG.DEBUG_DUMP_RESPONSE, dump: null })
						return
					}
					const dump = await dumpWorkerAppState(app.appModel, app.runtime.models ?? {})
					transport.send({ type: DKT_MSG.DEBUG_DUMP_RESPONSE, dump })
					return
				}
			}
		}

		const unlisten = transport.listen((message: MiniCutDktTransportMessage) => {
			messageQueue = messageQueue
				.then(() => handleMessage(message))
				.catch((error) => sendError(error, 'requestId' in message ? message.requestId : undefined))
		})

		// Subscribe to disconnect event and clear export progress
		const unlistenDisconnect = transport.onDisconnect?.(() => {
			logRuntime('transport:onDisconnect', { activeSessionKey })
			void clearExportProgressInAllSessions()
		}) ?? (() => {})

		const destroy = (): void => {
			if (destroyed) {
				return
			}
			destroyed = true
			activeTransports.delete(transport)
			unlisten()
			unlistenDisconnect()
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

	const debugDumpState = async () => {
		const app = await bootstrapApp()
		if (!app) {
			return {
				enabled,
				booted: false,
				sessions: [...sessionRootPromises.keys()],
				modelsCount: 0,
			}
		}

		return {
			enabled,
			booted: true,
			sessions: [...sessionRootPromises.keys()],
			modelsCount: Object.keys(app.runtime.models ?? {}).length,
			rootNodeId: app.appModel._node_id ?? null,
		}
	}

	return { connect, debugDumpState }
}
