import type { EditorAuthorityClient } from './authorityClient'
import type { BridgeSignalingFactory } from '../p2p/BridgeSignaling'
import type { PageP2PManager, PageP2PManagerConfig, PageP2PManagerEvents } from '../p2p/PageP2PManager'
import { createP2PAuthorityAdapter, type CreateP2PAuthorityAdapterConfig } from '../p2p/P2PAuthorityAdapter'
import { createFallbackAuthorityClient } from './fallbackAuthorityClient'

export interface AuthorityRawTransportLike {
	send(data: string | ArrayBuffer): void | Promise<void>
	listen(listener: (data: string | ArrayBuffer) => void): () => void
	destroy(): void
}

export interface AuthorityResourceBindings {
	onClientResourceTransport?: (transport: AuthorityRawTransportLike) => void
	onServerResourceTransport?: (remotePeerId: string, transport: AuthorityRawTransportLike) => void
	onResourcePeerDisconnected?: (remotePeerId: string) => void
}

export interface CreateAuthorityClientOptions {
	p2p?: {
		roomId: string
		signalUrl: string
		workerUrl?: string | URL
		rtcConfig?: RTCConfiguration
		createSignaling?: BridgeSignalingFactory
		connectionTimeoutMs?: number
		requestTimeoutMs?: number
		pendingCallTimeoutMs?: number
		createManager?: (config: PageP2PManagerConfig, events: PageP2PManagerEvents) => PageP2PManager
		createLocalAuthority?: CreateP2PAuthorityAdapterConfig['createLocalAuthority']
		onClientResourceTransport?: AuthorityResourceBindings['onClientResourceTransport']
		onServerResourceTransport?: AuthorityResourceBindings['onServerResourceTransport']
		onResourcePeerDisconnected?: AuthorityResourceBindings['onResourcePeerDisconnected']
		onSessionLost?: (reason: string) => void
		onError?: (error: unknown) => void
	}
}

export const createAuthorityClient = (options: CreateAuthorityClientOptions = {}): EditorAuthorityClient => {
	if (options.p2p?.roomId && options.p2p.signalUrl) {
		return createP2PAuthorityAdapter({
			roomId: options.p2p.roomId,
			signalUrl: options.p2p.signalUrl,
			workerUrl: options.p2p.workerUrl,
			rtcConfig: options.p2p.rtcConfig,
			createSignaling: options.p2p.createSignaling,
			connectionTimeoutMs: options.p2p.connectionTimeoutMs,
			requestTimeoutMs: options.p2p.requestTimeoutMs,
			pendingCallTimeoutMs: options.p2p.pendingCallTimeoutMs,
			createManager: options.p2p.createManager,
			createLocalAuthority: options.p2p.createLocalAuthority,
			onClientResourceTransport: options.p2p.onClientResourceTransport,
			onServerResourceTransport: options.p2p.onServerResourceTransport,
			onResourcePeerDisconnected: options.p2p.onResourcePeerDisconnected,
			onSessionLost: options.p2p.onSessionLost,
			onError: options.p2p.onError,
		})
	}

	return createFallbackAuthorityClient()
}
