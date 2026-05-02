import { nanoid } from 'nanoid'
import { MSG, type Command, type DispatchResult, type HistoryState, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import { MemoryWorkerAuthority } from '../worker/memoryWorker'
import { canUseSharedWorkerAuthority, SharedWorkerAuthorityClient } from '../worker/sharedWorkerClient'
import type { EditorAuthorityClient, PatchListener } from '../worker/authorityClient'
import type { BridgeSignalingFactory } from './BridgeSignaling'
import {
	createPageP2PManager,
	type P2PRawTransportLike,
	type P2PTransportLike,
	type PageP2PManager,
	type PageP2PManagerConfig,
	type PageP2PManagerEvents,
} from './PageP2PManager'

interface PendingCall<T> {
	run(client: EditorAuthorityClient): void
	reject(error: unknown): void
	timeoutId: ReturnType<typeof setTimeout>
}

interface TransportPendingRequest {
	resolve(value: unknown): void
	reject(reason: unknown): void
	timeoutId: ReturnType<typeof setTimeout>
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const DEFAULT_PENDING_CALL_TIMEOUT_MS = 30_000
const P2P_SHARED_WORKER_NAME_PREFIX = 'minicut-video-editor-authority:p2p:'

type RestorableAuthorityClient = EditorAuthorityClient & {
	replaceSnapshot(snapshot: ProjectRegistry): Promise<void>
}

const canReplaceSnapshot = (client: EditorAuthorityClient): client is RestorableAuthorityClient =>
	typeof (client as Partial<RestorableAuthorityClient>).replaceSnapshot === 'function'

const createTransportAuthorityClient = (
	transport: P2PTransportLike,
	requestTimeoutMs: number,
): EditorAuthorityClient => {
	const listeners = new Set<PatchListener>()
	const pending = new Map<string, TransportPendingRequest>()
	let destroyed = false

	const cleanupPending = (error: Error): void => {
		for (const [requestId, request] of pending) {
			clearTimeout(request.timeoutId)
			request.reject(new Error(`${error.message}: ${requestId}`))
		}
		pending.clear()
	}

	const unlisten = transport.listen((message) => {
		if (destroyed) {
			return
		}

		if (message.m === MSG.PATCHES) {
			for (const listener of listeners) {
				listener(message.p as PatchEnvelope)
			}
			return
		}

		if (!message.requestId) {
			return
		}

		const request = pending.get(message.requestId)
		if (!request) {
			return
		}

		pending.delete(message.requestId)
		clearTimeout(request.timeoutId)
		if (message.m === MSG.ERROR) {
			request.reject(new Error(String(message.p ?? 'Unknown P2P authority error')))
			return
		}

		request.resolve(message.p)
	})

	const request = <T>(message: WireMessage): Promise<T> => new Promise((resolve, reject) => {
		if (destroyed) {
			reject(new Error('P2P transport authority is destroyed'))
			return
		}

		const requestId = nanoid(8)
		const timeoutId = setTimeout(() => {
			pending.delete(requestId)
			reject(new Error(`P2P authority request timed out: ${message.m}`))
		}, requestTimeoutMs)

		pending.set(requestId, {
			resolve: resolve as (value: unknown) => void,
			reject,
			timeoutId,
		})
		transport.send({ ...message, requestId })
	})

	return {
		getSnapshot() {
			return request<ProjectRegistry>({ m: MSG.SNAPSHOT_REQUEST })
		},

		getHistoryState() {
			return request<HistoryState>({ m: MSG.HISTORY_STATE_REQUEST })
		},

		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		dispatch(command) {
			return request<DispatchResult>({ m: MSG.COMMAND, p: command })
		},

		undo() {
			return request<PatchEnvelope | null>({ m: MSG.UNDO })
		},

		redo() {
			return request<PatchEnvelope | null>({ m: MSG.REDO })
		},

		destroy() {
			if (destroyed) {
				return
			}

			destroyed = true
			unlisten()
			listeners.clear()
			cleanupPending(new Error('P2P authority request cancelled'))
			transport.destroy()
		},
	}
}

const toWorkerScopeKey = (roomId: string): string =>
	roomId.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80)

export interface CreateP2PAuthorityAdapterConfig {
	roomId: string
	signalUrl: string
	workerUrl: string | URL
	rtcConfig?: RTCConfiguration
	createSignaling?: BridgeSignalingFactory
	connectionTimeoutMs?: number
	requestTimeoutMs?: number
	pendingCallTimeoutMs?: number
	createLocalAuthority?: () => EditorAuthorityClient
	createManager?: (config: PageP2PManagerConfig, events: PageP2PManagerEvents) => PageP2PManager
	onClientResourceTransport?: (transport: P2PRawTransportLike) => void
	onServerResourceTransport?: (remotePeerId: string, transport: P2PRawTransportLike) => void
	onResourcePeerDisconnected?: (remotePeerId: string) => void
	onSessionLost?: (reason: string) => void
	onError?: (error: unknown) => void
}

export interface P2PAuthorityAdapter extends EditorAuthorityClient {
	readonly role: 'server' | 'client' | 'undecided'
	readonly peerId: string
}

export const createP2PAuthorityAdapter = (config: CreateP2PAuthorityAdapterConfig): P2PAuthorityAdapter => {
	const roomScopedWorkerName = `${P2P_SHARED_WORKER_NAME_PREFIX}${toWorkerScopeKey(config.roomId)}`
	const createLocalAuthority = config.createLocalAuthority ?? (() => {
		if (canUseSharedWorkerAuthority()) {
			return new SharedWorkerAuthorityClient({
				workerUrl: config.workerUrl,
				name: roomScopedWorkerName,
			})
		}

		return new MemoryWorkerAuthority()
	})
	const createManager = config.createManager ?? createPageP2PManager
	const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
	const pendingCallTimeoutMs = config.pendingCallTimeoutMs ?? DEFAULT_PENDING_CALL_TIMEOUT_MS

	let destroyed = false
	let role: 'server' | 'client' | 'undecided' = 'undecided'
	let activeClient: EditorAuthorityClient | null = null
	let activeClientUnsubscribe: (() => void) | null = null
	let hasCachedSnapshot = false
	let cachedSnapshot = createEmptyRegistry()

	const listeners = new Set<PatchListener>()
	const pending: PendingCall<unknown>[] = []

	const setCachedSnapshot = (snapshot: ProjectRegistry): void => {
		hasCachedSnapshot = true
		cachedSnapshot = structuredClone(snapshot)
	}

	const failPending = (error: Error): void => {
		const calls = pending.splice(0, pending.length)
		for (const call of calls) {
			clearTimeout(call.timeoutId)
			call.reject(error)
		}
	}

	const cleanupActiveClient = (): void => {
		activeClientUnsubscribe?.()
		activeClientUnsubscribe = null
		activeClient?.destroy?.()
		activeClient = null
	}

	const activateClient = (nextRole: 'server' | 'client', nextClient: EditorAuthorityClient): void => {
		if (destroyed) {
			nextClient.destroy?.()
			return
		}

		cleanupActiveClient()
		role = nextRole
		activeClient = nextClient
		activeClientUnsubscribe = nextClient.subscribe((envelope) => {
			if (hasCachedSnapshot) {
				try {
					applyPatchEnvelopeInPlace(cachedSnapshot, envelope)
				} catch {
					// ignore invalid cache update attempts
				}
			}

			for (const listener of listeners) {
				listener(envelope)
			}
		})

		const flushQueuedCalls = (): void => {
			const queuedCalls = pending.splice(0, pending.length)
			for (const call of queuedCalls) {
				clearTimeout(call.timeoutId)
				call.run(nextClient)
			}
		}

		if (nextRole === 'server' && hasCachedSnapshot && canReplaceSnapshot(nextClient)) {
			void nextClient.replaceSnapshot(cachedSnapshot)
		}

		flushQueuedCalls()
	}

	const invoke = <T>(operation: (client: EditorAuthorityClient) => T | Promise<T>): Promise<T> => {
		if (destroyed) {
			return Promise.reject(new Error('P2P authority adapter is destroyed'))
		}

		if (activeClient) {
			return Promise.resolve(operation(activeClient))
		}

		return new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const index = pending.findIndex((call) => call.timeoutId === timeoutId)
				if (index === -1) {
					return
				}

				pending.splice(index, 1)
				reject(new Error('P2P authority role resolution timed out'))
			}, pendingCallTimeoutMs)

			pending.push({
				run(client) {
					Promise.resolve(operation(client)).then(resolve, reject)
				},
				reject,
				timeoutId,
			})
		})
	}

	const manager = createManager(
		{
			roomId: config.roomId,
			signalUrl: config.signalUrl,
			workerUrl: config.workerUrl,
			rtcConfig: config.rtcConfig,
			createSignaling: config.createSignaling,
			sharedWorkerName: roomScopedWorkerName,
			connectionTimeoutMs: config.connectionTimeoutMs,
		},
		{
			onBecomeServer() {
				activateClient('server', createLocalAuthority())
			},

			onBecomeClient(transport) {
				activateClient('client', createTransportAuthorityClient(transport, requestTimeoutMs))
			},

			onClientResourceTransport(transport) {
				config.onClientResourceTransport?.(transport)
			},

			onServerResourceTransport(remotePeerId, transport) {
				config.onServerResourceTransport?.(remotePeerId, transport)
			},

			onResourcePeerDisconnected(remotePeerId) {
				config.onResourcePeerDisconnected?.(remotePeerId)
			},

			onSessionLost(reason) {
				cleanupActiveClient()
				role = 'undecided'
				failPending(new Error(`P2P session lost: ${reason}`))
				config.onSessionLost?.(reason)
			},

			onError(error) {
				config.onError?.(error)
			},
		},
	)

	return {
		get role() {
			return role
		},

		get peerId() {
			return manager.peerId
		},

		getSnapshot() {
			return invoke((client) => client.getSnapshot()).then((snapshot) => {
				setCachedSnapshot(snapshot)
				return snapshot
			})
		},

		getHistoryState() {
			return invoke((client) => client.getHistoryState())
		},

		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		dispatch(command: Command) {
			return invoke((client) => client.dispatch(command))
		},

		undo() {
			return invoke((client) => client.undo())
		},

		redo() {
			return invoke((client) => client.redo())
		},

		destroy() {
			if (destroyed) {
				return
			}

			destroyed = true
			failPending(new Error('P2P authority adapter destroyed'))
			listeners.clear()
			cleanupActiveClient()
			manager.destroy()
		},
	}
}