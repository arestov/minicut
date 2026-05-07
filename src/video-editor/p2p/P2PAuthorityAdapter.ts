import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'
import { createFallbackAuthorityClient } from '../worker/fallbackAuthorityClient'
import type { DktSyncListener, EditorAuthorityClient } from '../worker/authorityClient'
import type { AuthorityResourceBindings } from '../worker/createAuthorityClient'
import type { BridgeSignalingFactory } from './BridgeSignaling'
import {
	createPageP2PManager,
	type P2PTransportLike,
	type PageP2PManager,
	type PageP2PManagerConfig,
	type PageP2PManagerEvents,
} from './PageP2PManager'

const P2P_SHARED_WORKER_NAME_PREFIX = 'minicut-video-editor-authority:p2p:'

const toWorkerScopeKey = (roomId: string): string =>
	roomId.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80)

/**
 * Phase 1: DKT-only transport authority wrapping P2P transport.
 * No registry protocol. Only openDktTransport() which forwards DKT messages over the P2P link.
 */
const createTransportAuthorityClient = (
	transport: P2PTransportLike,
): EditorAuthorityClient => {
	const syncListeners = new Set<DktSyncListener>()
	let destroyed = false

	const unlistenTransport = transport.listen((message) => {
		if (destroyed || !message || typeof message !== 'object' || !('type' in message)) {
			return
		}

		if (message.type === DKT_MSG.SYNC_HANDLE) {
			const syncMsg = message as Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>
			for (const listener of syncListeners) {
				listener(syncMsg)
			}
		}
	})

	return {
		openDktTransport(): DomSyncTransportLike<MiniCutDktTransportMessage> {
			const transportListeners = new Set<(message: MiniCutDktTransportMessage) => void>()
			const unlistenAll = transport.listen((message) => {
				if (message && typeof message === 'object' && 'type' in message) {
					for (const listener of transportListeners) {
						listener(message as MiniCutDktTransportMessage)
					}
				}
			})

			return {
				send(message) {
					transport.send(message)
				},
				listen(listener) {
					transportListeners.add(listener)
					return () => {
						transportListeners.delete(listener)
					}
				},
				destroy() {
					transportListeners.clear()
					unlistenAll()
				},
			}
		},

		subscribeDktSync(listener) {
			syncListeners.add(listener)
			return () => {
				syncListeners.delete(listener)
			}
		},

		destroy() {
			if (destroyed) {
				return
			}

			destroyed = true
			unlistenTransport()
			syncListeners.clear()
			transport.destroy()
		},
	}
}

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

	let destroyed = false
	let role: 'server' | 'client' | 'undecided' = 'undecided'
	let activeClient: EditorAuthorityClient | null = null

	const dktSyncListeners = new Set<DktSyncListener>()

	const cleanupActiveClient = (): void => {
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
		nextClient.subscribeDktSync?.((message) => {
			for (const listener of dktSyncListeners) {
				listener(message)
			}
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
				activateClient('client', createTransportAuthorityClient(transport))
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

		subscribeDktSync(listener) {
			dktSyncListeners.add(listener)
			return () => {
				dktSyncListeners.delete(listener)
			}
		},

		openDktTransport() {
			// Create a proxy transport that can switch its underlying transport on failover.
			// The proxy buffers messages until an activeClient is ready, then forwards them.
			// When activeClient changes (e.g. failover from client → server), the old transport
			// is destroyed and a new one opened, preserving all page-side listeners.
			// The last BOOTSTRAP message is cached so a new transport can be bootstrapped on reconnect.
			const pendingMessages: MiniCutDktTransportMessage[] = []
			const transportListeners = new Set<(message: MiniCutDktTransportMessage) => void>()
			let realTransport: DomSyncTransportLike<MiniCutDktTransportMessage> | null = null
			let realUnlisten: (() => void) | null = null
			let realTransportClient: EditorAuthorityClient | null = null
			let lastBootstrapMessage: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.BOOTSTRAP }> | null = null
			let isDestroyed = false

			const teardownRealTransport = (): void => {
				if (realTransport) {
					realUnlisten?.()
					realTransport.destroy()
					realTransport = null
					realUnlisten = null
					realTransportClient = null
				}
			}

			const activateRealTransport = (): void => {
				if (isDestroyed) {
					return
				}

				if (!activeClient || typeof activeClient.openDktTransport !== 'function') {
					return
				}

				// If activeClient changed (e.g. failover), tear down the old transport and reconnect.
				// Notify page transports that P2P session was lost so they reset sync state and
				// re-bootstrap against the new server authority.
				const isFailover = realTransportClient !== null && realTransportClient !== activeClient
				if (isFailover) {
					teardownRealTransport()
					const sessionLostMessage: MiniCutDktTransportMessage = {
						type: DKT_MSG.P2P_SESSION_LOST,
						reason: 'failover',
					}
					for (const listener of transportListeners) {
						listener(sessionLostMessage)
					}
				} else if (realTransportClient !== activeClient) {
					teardownRealTransport()
				}

				if (realTransport) {
					return
				}

				realTransportClient = activeClient
				realTransport = activeClient.openDktTransport()
				realUnlisten = realTransport.listen((message) => {
					for (const listener of transportListeners) {
						listener(message)
					}
				})

				// On reconnect, send the cached BOOTSTRAP first so the new authority worker
				// initialises the session before processing other messages.
				if (lastBootstrapMessage) {
					realTransport.send(lastBootstrapMessage)
				}

				// Send any pending messages
				while (pendingMessages.length > 0) {
					const message = pendingMessages.shift()
					if (message) {
						realTransport.send(message)
					}
				}
			}

			// Try to activate immediately if activeClient is already ready
			activateRealTransport()

			// Also set up a listener for when activeClient becomes available or changes
			const checkInterval = setInterval(() => {
				activateRealTransport()
			}, 100)

			return {
				send(message) {
					// Cache the most recent BOOTSTRAP so we can replay it on transport reconnect
					if (message.type === DKT_MSG.BOOTSTRAP) {
						lastBootstrapMessage = message as Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.BOOTSTRAP }>
					}
					if (realTransport) {
						realTransport.send(message)
					} else {
						pendingMessages.push(message)
					}
				},
				listen(listener) {
					transportListeners.add(listener)
					return () => {
						transportListeners.delete(listener)
					}
				},
				destroy() {
					isDestroyed = true
					clearInterval(checkInterval)
					teardownRealTransport()
					transportListeners.clear()
					pendingMessages.length = 0
				},
			}
		},

		destroy() {
			if (destroyed) {
				return
			}

			destroyed = true
			dktSyncListeners.clear()
			cleanupActiveClient()
			manager.destroy()
		},
	}
}
