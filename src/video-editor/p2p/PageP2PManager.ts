import { MSG, type WireMessage } from '../domain/types'
import type { BridgeSignalingFactory } from './BridgeSignaling'
import { createDoSignalingFactory } from './BridgeSignaling'
import type { SignalMessage } from './types'

export interface P2PTransportLike {
	send(message: WireMessage): void
	listen(listener: (message: WireMessage) => void): () => void
	destroy(): void
}

export interface PageP2PManagerConfig {
	roomId: string
	signalUrl: string
	workerUrl: string | URL
	rtcConfig?: RTCConfiguration
	createSignaling?: BridgeSignalingFactory
	dataChannelLabel?: string
	sharedWorkerName?: string
	connectionTimeoutMs?: number
}

export interface PageP2PManagerEvents {
	onBecomeServer(): void
	onBecomeClient(transport: P2PTransportLike): void
	onSessionLost(reason: string): void
	onError(error: unknown): void
}

export interface PageP2PManager {
	readonly role: 'server' | 'client' | 'undecided'
	readonly peerId: string
	destroy(): void
}

interface ProxyEntry {
	pc: RTCPeerConnection
	dc: RTCDataChannel | null
	proxyWorker: SharedWorker
	proxyPort: MessagePort
}

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000

const parseWireMessage = (payload: unknown): WireMessage | null => {
	if (!payload || typeof payload !== 'object') {
		return null
	}

	return payload as WireMessage
}

export const createPageP2PManager = (
	config: PageP2PManagerConfig,
	events: PageP2PManagerEvents,
): PageP2PManager => {
	const peerId = crypto.randomUUID()
	const rtcConfig = config.rtcConfig ?? DEFAULT_RTC_CONFIG
	const dataChannelLabel = config.dataChannelLabel ?? 'minicut-authority'
	const sharedWorkerName = config.sharedWorkerName ?? 'minicut-video-editor-authority'
	const connectionTimeoutMs = config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS

	let role: 'server' | 'client' | 'undecided' = 'undecided'
	let destroyed = false
	let serverPeerId: string | null = null
	let clientTransportReady = false
	let connectionWatchdog: ReturnType<typeof setTimeout> | null = null

	const proxyConnections = new Map<string, ProxyEntry>()
	const peerConnections = new Map<string, RTCPeerConnection>()
	const dataChannels = new Map<string, RTCDataChannel>()

	const clearConnectionWatchdog = (): void => {
		if (connectionWatchdog == null) {
			return
		}

		clearTimeout(connectionWatchdog)
		connectionWatchdog = null
	}

	const scheduleConnectionWatchdog = (targetPeerId: string, pc: RTCPeerConnection): void => {
		clearConnectionWatchdog()
		connectionWatchdog = setTimeout(() => {
			connectionWatchdog = null
			if (destroyed || role !== 'client' || serverPeerId !== targetPeerId) {
				return
			}

			try {
				pc.close()
			} catch {
				// noop
			}

			events.onError(new Error('WebRTC connection timed out'))
		}, connectionTimeoutMs)
	}

	const createSignaling = config.createSignaling ?? createDoSignalingFactory(config.signalUrl)

	let signaling: ReturnType<BridgeSignalingFactory> | null = createSignaling({
		roomId: config.roomId,
		peerId,
		joinedAt: Date.now(),
		events: {
			onMemberJoined() {
				// role decision is driven by leader assignment
			},

			onMemberLeft(remotePeerId) {
				if (destroyed) {
					return
				}

				cleanupProxy(remotePeerId)
				const pc = peerConnections.get(remotePeerId)
				if (pc) {
					pc.close()
					peerConnections.delete(remotePeerId)
				}
				dataChannels.delete(remotePeerId)
			},

			onLeaderAssigned(leaderPeerId) {
				if (destroyed) {
					return
				}

				if (leaderPeerId === peerId) {
					becomeServer()
					return
				}

				if (role !== 'client' || serverPeerId !== leaderPeerId) {
					becomeClient(leaderPeerId)
				}
			},

			onSignal(msg) {
				if (destroyed) {
					return
				}

				handleSignal(msg)
			},

			onConnected() {
				// leader assignment follows in room-state
			},

			onError(error) {
				if (destroyed) {
					return
				}

				if (role === 'undecided') {
					becomeServer()
					return
				}

				if (role === 'server' || (role === 'client' && clientTransportReady)) {
					return
				}

				events.onError(error)
			},
		},
	})

	const sendSignal = (msg: SignalMessage): void => {
		signaling?.sendSignal(msg)
	}

	const createDcTransport = (dc: RTCDataChannel): P2PTransportLike => {
		const listeners = new Set<(message: WireMessage) => void>()
		let transportDestroyed = false

		dc.onmessage = (event) => {
			if (transportDestroyed) {
				return
			}

			let parsed: unknown
			try {
				parsed = JSON.parse(String(event.data))
			} catch {
				return
			}

			const message = parseWireMessage(parsed)
			if (!message) {
				return
			}

			for (const listener of listeners) {
				listener(message)
			}
		}

		dc.onclose = () => {
			if (transportDestroyed || destroyed) {
				return
			}

			clientTransportReady = false
			events.onSessionLost('server-gone')
		}

		dc.onerror = () => {
			// onclose handles the lifecycle edge
		}

		return {
			send(message) {
				if (transportDestroyed || dc.readyState !== 'open') {
					return
				}

				dc.send(JSON.stringify(message))
			},

			listen(listener) {
				listeners.add(listener)
				return () => {
					listeners.delete(listener)
				}
			},

			destroy() {
				transportDestroyed = true
				listeners.clear()
				dc.close()
			},
		}
	}

	const cleanupProxy = (remotePeerId: string): void => {
		const entry = proxyConnections.get(remotePeerId)
		if (!entry) {
			return
		}

		entry.proxyPort.onmessage = null
		try {
			entry.proxyPort.postMessage({ m: MSG.DISCONNECT })
		} catch {
			// noop
		}
		entry.proxyPort.close()
		entry.dc?.close()
		entry.pc.close()
		proxyConnections.delete(remotePeerId)
	}

	const setupServerProxy = (remotePeerId: string, dc: RTCDataChannel, pc: RTCPeerConnection): void => {
		const proxyWorker = new SharedWorker(config.workerUrl, {
			type: 'module',
			name: sharedWorkerName,
		})
		const proxyPort = proxyWorker.port
		proxyPort.start()

		dc.onmessage = (event) => {
			if (destroyed) {
				return
			}

			try {
				const parsed = JSON.parse(String(event.data))
				proxyPort.postMessage(parsed)
			} catch {
				// noop
			}
		}

		proxyPort.onmessage = (event: MessageEvent<WireMessage>) => {
			if (dc.readyState === 'open') {
				dc.send(JSON.stringify(event.data))
			}
		}

		dc.onclose = () => {
			cleanupProxy(remotePeerId)
		}

		proxyConnections.set(remotePeerId, {
			pc,
			dc,
			proxyWorker,
			proxyPort,
		})
	}

	const becomeServer = (): void => {
		if (role === 'server' || destroyed) {
			return
		}

		clientTransportReady = false
		serverPeerId = null
		role = 'server'
		events.onBecomeServer()
	}

	const becomeClient = (targetPeerId: string): void => {
		if (destroyed) {
			return
		}

		role = 'client'
		serverPeerId = targetPeerId
		clientTransportReady = false

		const pc = new RTCPeerConnection(rtcConfig)
		peerConnections.set(targetPeerId, pc)

		const dc = pc.createDataChannel(dataChannelLabel, { ordered: true })
		dataChannels.set(targetPeerId, dc)
		scheduleConnectionWatchdog(targetPeerId, pc)

		dc.onopen = () => {
			if (destroyed) {
				return
			}

			clearConnectionWatchdog()
			clientTransportReady = true
			events.onBecomeClient(createDcTransport(dc))
		}

		dc.onclose = () => {
			if (destroyed) {
				return
			}

			clearConnectionWatchdog()
			clientTransportReady = false
			dataChannels.delete(targetPeerId)
			events.onSessionLost('server-gone')
		}

		pc.onicecandidate = (event) => {
			if (!event.candidate || destroyed) {
				return
			}

			sendSignal({
				kind: 'ice-candidate',
				roomId: config.roomId,
				fromPeerId: peerId,
				toPeerId: targetPeerId,
				candidate: event.candidate.toJSON(),
				ts: Date.now(),
			})
		}

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'connected') {
				clearConnectionWatchdog()
				return
			}

			if (pc.connectionState === 'disconnected') {
				scheduleConnectionWatchdog(targetPeerId, pc)
				return
			}

			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				clearConnectionWatchdog()
				if (!destroyed && role === 'client' && serverPeerId === targetPeerId) {
					events.onSessionLost('server-gone')
				}
			}
		}

		void pc.createOffer()
			.then((offer) => pc.setLocalDescription(offer).then(() => offer))
			.then(() => {
				sendSignal({
					kind: 'offer',
					roomId: config.roomId,
					fromPeerId: peerId,
					toPeerId: targetPeerId,
					sdp: pc.localDescription?.toJSON() as RTCSessionDescriptionInit,
					ts: Date.now(),
				})
			})
			.catch((error) => {
				events.onError(error)
			})
	}

	const handleSignal = (msg: SignalMessage): void => {
		if (msg.fromPeerId === peerId || (msg.toPeerId && msg.toPeerId !== peerId)) {
			return
		}

		switch (msg.kind) {
			case 'offer': {
				if (role !== 'server') {
					return
				}

				const remotePeerId = msg.fromPeerId
				const pc = new RTCPeerConnection(rtcConfig)
				peerConnections.set(remotePeerId, pc)

				pc.ondatachannel = (event) => {
					setupServerProxy(remotePeerId, event.channel, pc)
				}

				pc.onicecandidate = (event) => {
					if (!event.candidate || destroyed) {
						return
					}

					sendSignal({
						kind: 'ice-candidate',
						roomId: config.roomId,
						fromPeerId: peerId,
						toPeerId: remotePeerId,
						candidate: event.candidate.toJSON(),
						ts: Date.now(),
					})
				}

				void pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
					.then(() => pc.createAnswer())
					.then((answer) => pc.setLocalDescription(answer))
					.then(() => {
						sendSignal({
							kind: 'answer',
							roomId: config.roomId,
							fromPeerId: peerId,
							toPeerId: remotePeerId,
							sdp: pc.localDescription?.toJSON() as RTCSessionDescriptionInit,
							ts: Date.now(),
						})
					})
					.catch((error) => {
						events.onError(error)
					})
				return
			}

			case 'answer': {
				const pc = peerConnections.get(msg.fromPeerId)
				if (!pc) {
					return
				}

				void pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch((error) => {
					events.onError(error)
				})
				return
			}

			case 'ice-candidate': {
				const pc = peerConnections.get(msg.fromPeerId)
				if (!pc) {
					return
				}

				void pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch((error) => {
					events.onError(error)
				})
				return
			}

			case 'server-leaving':
				if (role === 'client' && msg.fromPeerId === serverPeerId) {
					events.onSessionLost('server-gone')
				}
		}
	}

	return {
		get role() {
			return role
		},

		get peerId() {
			return peerId
		},

		destroy() {
			if (destroyed) {
				return
			}

			destroyed = true
			clearConnectionWatchdog()

			for (const remotePeerId of proxyConnections.keys()) {
				cleanupProxy(remotePeerId)
			}

			for (const pc of peerConnections.values()) {
				pc.close()
			}
			peerConnections.clear()
			dataChannels.clear()

			signaling?.sendBye?.()
			signaling?.destroy()
			signaling = null
		},
	}
}