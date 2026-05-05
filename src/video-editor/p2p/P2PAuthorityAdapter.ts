import { nanoid } from 'nanoid'
import { PATCH, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry } from '../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import { createFallbackAuthorityClient } from '../worker/fallbackAuthorityClient'
import type { EditorAuthorityClient, PatchListener } from '../worker/authorityClient'
import type { AuthorityResourceBindings } from '../worker/createAuthorityClient'
import type { BridgeSignalingFactory } from './BridgeSignaling'
import {
	createPageP2PManager,
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

const getRegistryEnvelopeProjectId = (snapshot: ProjectRegistry): string =>
	snapshot.activeProjectId ?? Object.keys(snapshot.projects)[0] ?? '__workspace__'

const createRegistrySetEnvelope = (snapshot: ProjectRegistry): PatchEnvelope => {
	const projectId = getRegistryEnvelopeProjectId(snapshot)
	return {
		projectId,
		version: snapshot.projects[projectId]?.version ?? 0,
		patches: [{ c: PATCH.REGISTRY_SET, p: { registry: structuredClone(snapshot) } }],
	}
}

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

		if (!('type' in message)) {
			return
		}

		switch (message.type) {
			case DKT_MSG.PATCHES:
				for (const listener of listeners) {
					listener(message.envelope as PatchEnvelope)
				}
				return
			case DKT_MSG.SNAPSHOT:
				resolvePending(message.requestId, message.snapshot)
				return
			case DKT_MSG.DISPATCH_RESULT:
				resolvePending(message.requestId, message.result)
				return
			case DKT_MSG.RUNTIME_ERROR:
				rejectPending(message.requestId, new Error(String(message.message ?? 'Unknown P2P DKT authority error')))
				return
		}
	})

	const resolvePending = (requestId: string | undefined, value: unknown): void => {
		if (!requestId) {
			return
		}
		const request = pending.get(requestId)
		if (!request) {
			return
		}
		pending.delete(requestId)
		clearTimeout(request.timeoutId)
		request.resolve(value)
	}

	const rejectPending = (requestId: string | undefined, error: Error): void => {
		if (!requestId) {
			return
		}
		const request = pending.get(requestId)
		if (!request) {
			return
		}
		pending.delete(requestId)
		clearTimeout(request.timeoutId)
		request.reject(error)
	}

	const request = <T>(message: MiniCutDktTransportMessage): Promise<T> => new Promise((resolve, reject) => {
		if (destroyed) {
			reject(new Error('P2P transport authority is destroyed'))
			return
		}

		const requestId = nanoid(8)
		const timeoutId = setTimeout(() => {
			pending.delete(requestId)
			reject(new Error(`P2P DKT authority request timed out: ${message.type}`))
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
			return request<ProjectRegistry>({ type: DKT_MSG.GET_SNAPSHOT })
		},

		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		dispatch(command) {
			return request<DispatchResult>({ type: DKT_MSG.DISPATCH_COMMAND, command })
		},

		replaceSnapshot(snapshot) {
			return request<ProjectRegistry>({ type: DKT_MSG.REPLACE_SNAPSHOT, snapshot: structuredClone(snapshot) }).then(() => undefined)
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
	workerUrl?: string | URL
	rtcConfig?: RTCConfiguration
	createSignaling?: BridgeSignalingFactory
	connectionTimeoutMs?: number
	requestTimeoutMs?: number
	pendingCallTimeoutMs?: number
	createLocalAuthority?: () => EditorAuthorityClient
	createManager?: (config: PageP2PManagerConfig, events: PageP2PManagerEvents) => PageP2PManager
	onClientResourceTransport?: AuthorityResourceBindings['onClientResourceTransport']
	onServerResourceTransport?: AuthorityResourceBindings['onServerResourceTransport']
	onResourcePeerDisconnected?: AuthorityResourceBindings['onResourcePeerDisconnected']
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
		return createFallbackAuthorityClient({
			workerUrl: config.workerUrl,
			name: roomScopedWorkerName,
		})
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
	let activationHydrationPending = false
	let activationToken = 0

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

		activationToken += 1
		const currentActivationToken = activationToken
		cleanupActiveClient()
		role = nextRole
		const shouldRestoreServerSnapshot = nextRole === 'server' && hasCachedSnapshot && canReplaceSnapshot(nextClient)
		const shouldSyncClientSnapshot = nextRole === 'client'
		activationHydrationPending = shouldRestoreServerSnapshot || shouldSyncClientSnapshot
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
			if (destroyed || currentActivationToken !== activationToken || activationHydrationPending) {
				return
			}

			const queuedCalls = pending.splice(0, pending.length)
			for (const call of queuedCalls) {
				clearTimeout(call.timeoutId)
				call.run(nextClient)
			}
		}

		if (shouldRestoreServerSnapshot) {
			void Promise.resolve(nextClient.replaceSnapshot(cachedSnapshot)).then(() => {
				if (destroyed || currentActivationToken !== activationToken) {
					return
				}

				activationHydrationPending = false
				flushQueuedCalls()
			}).catch((error: unknown) => {
				if (destroyed || currentActivationToken !== activationToken) {
					return
				}

				activationHydrationPending = false
				config.onError?.(error)
				flushQueuedCalls()
			})
			return
		}

		if (shouldSyncClientSnapshot) {
			void Promise.resolve(nextClient.getSnapshot()).then((snapshot) => {
				if (destroyed || currentActivationToken !== activationToken) {
					return
				}

				setCachedSnapshot(snapshot)
				const envelope = createRegistrySetEnvelope(snapshot)
				for (const listener of listeners) {
					listener(envelope)
				}
				activationHydrationPending = false
				flushQueuedCalls()
			}).catch((error) => {
				if (destroyed || currentActivationToken !== activationToken) {
					return
				}

				activationHydrationPending = false
				config.onError?.(error)
				flushQueuedCalls()
			})
			return
		}

		flushQueuedCalls()
	}

	const invoke = <T>(operation: (client: EditorAuthorityClient) => T | Promise<T>): Promise<T> => {
		if (destroyed) {
			return Promise.reject(new Error('P2P authority adapter is destroyed'))
		}

		if (activeClient && !activationHydrationPending) {
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
			workerProtocol: 'dkt',
			connectionTimeoutMs: config.connectionTimeoutMs,
		},
		{
			onBecomeServer() {
				console.info('[minicut:p2p] authority role=server', {
					roomId: config.roomId,
					peerId: manager.peerId,
				})
				activateClient('server', createLocalAuthority())
			},

			onBecomeClient(transport) {
				console.info('[minicut:p2p] authority role=client', {
					roomId: config.roomId,
					peerId: manager.peerId,
				})
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
				console.warn('[minicut:p2p] session lost; waiting for role re-assignment', {
					roomId: config.roomId,
					peerId: manager.peerId,
					reason,
				})
				cleanupActiveClient()
				failPending(new Error(`P2P session lost: ${reason}`))
				config.onSessionLost?.(reason)
			},

			onError(error) {
				console.warn('[minicut:p2p] manager error', error)
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

		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		dispatch(command: Command) {
			return invoke((client) => client.dispatch(command))
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
