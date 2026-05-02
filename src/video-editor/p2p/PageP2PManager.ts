import { MSG, type WireMessage } from '../domain/types'
import type { BridgeSignalingFactory } from './BridgeSignaling'
import { createDoSignalingFactory } from './BridgeSignaling'
import type { SignalMessage } from './types'

export interface P2PTransportLike {
	send(message: WireMessage): void
	listen(listener: (message: WireMessage) => void): () => void
	destroy(): void
}

export interface P2PRawTransportLike {
	send(data: string | ArrayBuffer): void
	listen(listener: (data: string | ArrayBuffer) => void): () => void
	destroy(): void
}

export interface PageP2PManagerConfig {
	roomId: string
	signalUrl: string
	workerUrl: string | URL
	rtcConfig?: RTCConfiguration
	createSignaling?: BridgeSignalingFactory
	dataChannelLabel?: string
	resourceDataChannelLabel?: string
	sharedWorkerName?: string
	connectionTimeoutMs?: number
}

export interface PageP2PManagerEvents {
	onBecomeServer(): void
	onBecomeClient(transport: P2PTransportLike): void
	onClientResourceTransport?(transport: P2PRawTransportLike): void
	onServerResourceTransport?(remotePeerId: string, transport: P2PRawTransportLike): void
	onResourcePeerDisconnected?(remotePeerId: string): void
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

export const DEFAULT_STUN_ICE_SERVER: RTCIceServer = {
	urls: 'stun:stun.l.google.com:19302',
}

export const createDefaultRtcConfig = (turnIceServer?: RTCIceServer | null): RTCConfiguration => ({
	iceServers: [DEFAULT_STUN_ICE_SERVER, ...(turnIceServer ? [turnIceServer] : [])],
})

const DEFAULT_RTC_CONFIG: RTCConfiguration = createDefaultRtcConfig()

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
	const resourceDataChannelLabel = config.resourceDataChannelLabel ?? 'minicut-resource'
	const sharedWorkerName = config.sharedWorkerName ?? 'minicut-video-editor-authority'
	const connectionTimeoutMs = config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS

	let role: 'server' | 'client' | 'undecided' = 'undecided'
	let destroyed = false
	let serverPeerId: string | null = null
	let clientTransportReady = false
	let sessionLostNotified = false
	let currentLeaderEpoch = -1
	let connectionWatchdog: ReturnType<typeof setTimeout> | null = null

	const proxyConnections = new Map<string, ProxyEntry>()
	const peerConnections = new Map<string, RTCPeerConnection>()
	const dataChannels = new Map<string, RTCDataChannel>()
	const resourceTransports = new Map<string, P2PRawTransportLike>()

	const closePeer = (remotePeerId: string): void => {
		const pc = peerConnections.get(remotePeerId)
		if (pc) {
			pc.close()
			peerConnections.delete(remotePeerId)
		}
		dataChannels.delete(remotePeerId)
		const resourceTransport = resourceTransports.get(remotePeerId)
		if (resourceTransport) {
			resourceTransport.destroy()
			resourceTransports.delete(remotePeerId)
			events.onResourcePeerDisconnected?.(remotePeerId)
		}
		cleanupProxy(remotePeerId)
	}

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

	const notifySessionLost = (reason: string): void => {
		if (destroyed || role !== 'client' || sessionLostNotified) {
			return
		}

		sessionLostNotified = true
		clientTransportReady = false
		clearConnectionWatchdog()
		events.onSessionLost(reason)
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

					if (role === 'client' && remotePeerId === serverPeerId) {
						notifySessionLost('server-gone')
						return
					}

				closePeer(remotePeerId)
			},

			onLeaderAssigned(leaderPeerId, epoch) {
				if (destroyed) {
					return
				}

				if (!leaderPeerId || !Number.isFinite(epoch) || epoch < currentLeaderEpoch) {
					return
				}

				currentLeaderEpoch = epoch

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
					events.onError(error)
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

				notifySessionLost('server-gone')
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

	/**
	 * Maximum payload bytes per DataChannel frame.
	 *
	 * Chrome/Edge announces `a=max-message-size:262144` (256 KB) in SDP.
	 * Firefox respects this limit and throws if we exceed it.
	 * Using 64 KB gives a comfortable safety margin.
	 */
	const MAX_DC_PAYLOAD_BYTES = 64 * 1024

	/**
	 * Binary frame header layout (9 bytes):
	 *   [0-3]  uint32 BE  fragment index (0-based)
	 *   [4-7]  uint32 BE  total message size in bytes
	 *   [8]    uint8      0x01 = final fragment, 0x00 = more follow
	 */
	const FRAG_HEADER_BYTES = 9

	const sendFragmentedBinary = (dc: RTCDataChannel, data: ArrayBuffer): void => {
		const totalSize = data.byteLength
		let fragIndex = 0
		let offset = 0

		while (offset < totalSize) {
			const payloadSize = Math.min(MAX_DC_PAYLOAD_BYTES, totalSize - offset)
			const isLast = offset + payloadSize >= totalSize
			const frame = new ArrayBuffer(FRAG_HEADER_BYTES + payloadSize)
			const hdr = new DataView(frame)
			hdr.setUint32(0, fragIndex, false)
			hdr.setUint32(4, totalSize, false)
			hdr.setUint8(8, isLast ? 1 : 0)
			new Uint8Array(frame, FRAG_HEADER_BYTES).set(new Uint8Array(data, offset, payloadSize))
			dc.send(frame)
			offset += payloadSize
			fragIndex++
		}
	}

	const createRawDcTransport = (
		dc: RTCDataChannel,
		onClosed?: () => void,
	): P2PRawTransportLike => {
		const listeners = new Set<(data: string | ArrayBuffer) => void>()
		let transportDestroyed = false
		let deliveryQueue = Promise.resolve()

		// Reassembly state for fragmented binary messages.
		let fragParts: Uint8Array[] = []
		let fragExpectedSize = 0

		const enqueueDelivery = (deliver: () => void | Promise<void>): void => {
			deliveryQueue = deliveryQueue
				.then(async () => {
					if (transportDestroyed) {
						return
					}

					await deliver()
				})
				.catch(() => undefined)
		}

		const notifyListeners = (payload: string | ArrayBuffer): void => {
			for (const listener of listeners) {
				listener(payload)
			}
		}

		const handleBinaryFrame = (buffer: ArrayBuffer): void => {
			if (buffer.byteLength < FRAG_HEADER_BYTES) {
				// Too short to be a valid framed message – deliver as-is for compat.
				enqueueDelivery(() => {
					notifyListeners(buffer)
				})
				return
			}

			const hdr = new DataView(buffer)
			const totalSize = hdr.getUint32(4, false)
			const isLast = hdr.getUint8(8) === 1
			const payload = buffer.slice(FRAG_HEADER_BYTES)

			fragParts.push(new Uint8Array(payload))
			fragExpectedSize = totalSize

			if (!isLast) {
				return
			}

			// All fragments collected – assemble and deliver.
			const assembled = new Uint8Array(fragExpectedSize)
			let pos = 0
			for (const part of fragParts) {
				assembled.set(part, pos)
				pos += part.byteLength
			}
			fragParts = []
			fragExpectedSize = 0
			const completeBuffer = assembled.buffer
			enqueueDelivery(() => {
				notifyListeners(completeBuffer)
			})
		}

		dc.onmessage = (event) => {
			if (transportDestroyed) {
				return
			}

			const data = event.data
			if (typeof data === 'string') {
				enqueueDelivery(() => {
					notifyListeners(data)
				})
				return
			}

			if (data instanceof ArrayBuffer) {
				handleBinaryFrame(data)
				return
			}

			if (ArrayBuffer.isView(data)) {
				const view = data as ArrayBufferView
				const normalized = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
				handleBinaryFrame(normalized)
				return
			}

			if (typeof Blob !== 'undefined' && data instanceof Blob) {
				enqueueDelivery(async () => {
					const normalized = await data.arrayBuffer()
					if (!transportDestroyed) {
						handleBinaryFrame(normalized)
					}
				})
			}
		}

		dc.onclose = () => {
			if (transportDestroyed) {
				return
			}

			onClosed?.()
		}

		dc.onerror = () => {
			// onclose handles lifecycle teardown
		}

		return {
			send(data) {
				if (transportDestroyed || dc.readyState !== 'open') {
					return
				}

				if (typeof data === 'string') {
					dc.send(data)
					return
				}

				sendFragmentedBinary(dc, data)
			},

			listen(listener) {
				listeners.add(listener)
				return () => {
					listeners.delete(listener)
				}
			},

			destroy() {
				if (transportDestroyed) {
					return
				}

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

		if (serverPeerId) {
			closePeer(serverPeerId)
		}

		clientTransportReady = false
		sessionLostNotified = false
		serverPeerId = null
		role = 'server'
		events.onBecomeServer()
	}

	const becomeClient = (targetPeerId: string): void => {
		if (destroyed) {
			return
		}

		for (const remotePeerId of [...proxyConnections.keys()]) {
			cleanupProxy(remotePeerId)
		}

		for (const remotePeerId of [...peerConnections.keys()]) {
			closePeer(remotePeerId)
		}

		role = 'client'
		serverPeerId = targetPeerId
		clientTransportReady = false
		sessionLostNotified = false

		const pc = new RTCPeerConnection(rtcConfig)
		peerConnections.set(targetPeerId, pc)

		const dc = pc.createDataChannel(dataChannelLabel, { ordered: true })
		const resourceDc = pc.createDataChannel(resourceDataChannelLabel, { ordered: true })
		dataChannels.set(targetPeerId, dc)
		scheduleConnectionWatchdog(targetPeerId, pc)

		dc.onopen = () => {
			if (destroyed) {
				return
			}

			clearConnectionWatchdog()
			clientTransportReady = true
			sessionLostNotified = false
			events.onBecomeClient(createDcTransport(dc))
		}

		dc.onclose = () => {
			if (destroyed) {
				return
			}

			notifySessionLost('server-gone')
			dataChannels.delete(targetPeerId)
		}

		resourceDc.binaryType = 'arraybuffer'
		resourceDc.onopen = () => {
			if (destroyed) {
				return
			}

			const transport = createRawDcTransport(resourceDc, () => {
				resourceTransports.delete(targetPeerId)
				events.onResourcePeerDisconnected?.(targetPeerId)
			})
			resourceTransports.set(targetPeerId, transport)
			events.onClientResourceTransport?.(transport)
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
				if (!destroyed && serverPeerId === targetPeerId) {
					notifySessionLost('server-gone')
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
					closePeer(remotePeerId)
				const pc = new RTCPeerConnection(rtcConfig)
				peerConnections.set(remotePeerId, pc)

				pc.ondatachannel = (event) => {
					if (event.channel.label === resourceDataChannelLabel) {
						event.channel.binaryType = 'arraybuffer'
						const transport = createRawDcTransport(event.channel, () => {
							resourceTransports.delete(remotePeerId)
							events.onResourcePeerDisconnected?.(remotePeerId)
						})
						resourceTransports.set(remotePeerId, transport)
						events.onServerResourceTransport?.(remotePeerId, transport)
						return
					}

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
						notifySessionLost('server-gone')
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

			if (role === 'server') {
				signaling?.sendSignal({
					kind: 'server-leaving',
					roomId: config.roomId,
					fromPeerId: peerId,
					ts: Date.now(),
				})
			}

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