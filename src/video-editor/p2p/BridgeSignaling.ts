import type { SignalMessage } from './types'

export interface BridgeSignalingEvents {
	onMemberJoined(peerId: string, joinedAt: number): void
	onMemberLeft(peerId: string): void
	onSignal(msg: SignalMessage): void
	onLeaderAssigned(leaderPeerId: string, epoch: number): void
	onConnected(): void
	onError(error: unknown): void
}

export interface BridgeSignaling {
	sendSignal(msg: SignalMessage): void
	sendBye?(): void
	destroy(): void
}

export type BridgeSignalingFactory = (params: {
	roomId: string
	peerId: string
	joinedAt: number
	events: BridgeSignalingEvents
}) => BridgeSignaling

const MAX_CONNECT_RETRIES = 4
const RETRY_BASE_MS = 300

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' ? value as Record<string, unknown> : null

export const createDoSignalingFactory = (signalUrl: string): BridgeSignalingFactory => {
	return ({ roomId, peerId, events }) => {
		let destroyed = false
		const knownPeers = new Set<string>()
		let connected = false
		let retryCount = 0
		let retryTimer: ReturnType<typeof setTimeout> | null = null

		const wsUrl = signalUrl.includes('/api/signal/')
			? signalUrl
			: `${signalUrl.replace(/\/$/, '')}/api/signal/${encodeURIComponent(roomId)}`

		let ws: WebSocket | null = null

		const scheduleRetry = (): void => {
			if (destroyed || retryCount >= MAX_CONNECT_RETRIES) {
				events.onError(new Error('WebSocket signaling error'))
				return
			}

			const delay = RETRY_BASE_MS * 2 ** retryCount
			retryCount += 1
			retryTimer = setTimeout(connect, delay)
		}

		const onMessage = (event: MessageEvent): void => {
			if (destroyed) {
				return
			}

			let payload: unknown
			try {
				payload = JSON.parse(String(event.data))
			} catch {
				return
			}

			const msg = asRecord(payload)
			if (!msg) {
				return
			}

			switch (msg.type) {
				case 'room-state': {
					const peers = Array.isArray(msg.peers) ? msg.peers.filter((value): value is string => typeof value === 'string') : []
					const newPeers = new Set(peers.filter((id) => id !== peerId))
					for (const knownPeer of knownPeers) {
						if (!newPeers.has(knownPeer)) {
							knownPeers.delete(knownPeer)
							events.onMemberLeft(knownPeer)
						}
					}
					for (const nextPeer of newPeers) {
						if (!knownPeers.has(nextPeer)) {
							knownPeers.add(nextPeer)
							events.onMemberJoined(nextPeer, 0)
						}
					}

					connected = true
					retryCount = 0
					events.onLeaderAssigned(String(msg.leaderPeerId ?? ''), Number(msg.epoch ?? 0))
					events.onConnected()
					break
				}

				case 'leader-changed': {
					events.onLeaderAssigned(String(msg.leaderPeerId ?? ''), Number(msg.epoch ?? 0))
					break
				}

				case 'offer':
				case 'answer':
				case 'ice-candidate': {
					const from = String(msg.from ?? '')
					if (!from || from === peerId) {
						return
					}

					const to = typeof msg.to === 'string' ? msg.to : undefined
					if (to && to !== peerId) {
						return
					}

					events.onSignal({
						kind: msg.type,
						roomId,
						fromPeerId: from,
						toPeerId: to,
						ts: Number(msg.ts ?? Date.now()),
						...(msg.sdp ? { sdp: msg.sdp as RTCSessionDescriptionInit } : {}),
						...(msg.candidate ? { candidate: msg.candidate as RTCIceCandidateInit } : {}),
					} as SignalMessage)
					break
				}
			}
		}

		const onError = (): void => {
			if (destroyed) {
				return
			}
			if (!connected) {
				try {
					ws?.close()
				} catch {
					// noop
				}
				ws = null
				scheduleRetry()
				return
			}

			events.onError(new Error('WebSocket signaling error'))
		}

		const onClose = (): void => {
			if (destroyed) {
				return
			}

			if (!connected) {
				if (ws) {
					ws = null
					scheduleRetry()
				}
				return
			}

			events.onError(new Error('WebSocket signaling closed'))
		}

		const connect = (): void => {
			if (destroyed) {
				return
			}
			ws = new WebSocket(wsUrl)
			ws.onopen = () => {
				if (destroyed || !ws) {
					return
				}

				ws.send(JSON.stringify({ type: 'join', roomId, peerId }))
			}
			ws.onmessage = onMessage
			ws.onerror = onError
			ws.onclose = onClose
		}

		connect()

		const sendToServer = (payload: Record<string, unknown>): void => {
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				return
			}

			ws.send(JSON.stringify(payload))
		}

		return {
			sendSignal(msg: SignalMessage) {
				sendToServer({
					type: msg.kind,
					epoch: 0,
					from: peerId,
					to: msg.toPeerId,
					...(msg.kind === 'offer' || msg.kind === 'answer' ? { sdp: msg.sdp } : {}),
					...(msg.kind === 'ice-candidate' ? { candidate: msg.candidate } : {}),
					ts: msg.ts,
				})
			},

			sendBye() {
				sendToServer({ type: 'bye', roomId, peerId })
			},

			destroy() {
				if (destroyed) {
					return
				}

				destroyed = true
				if (retryTimer) {
					clearTimeout(retryTimer)
				}
				ws?.close()
				ws = null
			},
		}
	}
}

export const createWsSignalingFactory = (signalUrl: string): BridgeSignalingFactory => {
	return ({ roomId, peerId, joinedAt, events }) => {
		let destroyed = false
		let ws: WebSocket | null = new WebSocket(signalUrl)

		const sendSignal = (data: SignalMessage): void => {
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				return
			}

			ws.send(JSON.stringify({ action: 'signal', data }))
		}

		ws.onopen = () => {
			if (destroyed || !ws) {
				return
			}

			ws.send(JSON.stringify({ action: 'join', roomId, peerId, joinedAt }))
			events.onConnected()
		}

		ws.onmessage = (event) => {
			if (destroyed) {
				return
			}

			let payload: unknown
			try {
				payload = JSON.parse(String(event.data))
			} catch {
				return
			}

			const msg = asRecord(payload)
			if (!msg || typeof msg.action !== 'string') {
				return
			}

			switch (msg.action) {
				case 'members': {
					const members = Array.isArray(msg.members) ? msg.members : []
					for (const member of members) {
						const item = asRecord(member)
						if (!item || typeof item.peerId !== 'string') {
							continue
						}

						events.onMemberJoined(item.peerId, Number(item.joinedAt ?? 0))
					}
					break
				}

				case 'member-joined': {
					events.onMemberJoined(String(msg.peerId ?? ''), Number(msg.joinedAt ?? 0))
					break
				}

				case 'member-left': {
					events.onMemberLeft(String(msg.peerId ?? ''))
					break
				}

				case 'signal': {
					const signal = msg.data as SignalMessage
					if (!signal || signal.fromPeerId === peerId || (signal.toPeerId && signal.toPeerId !== peerId)) {
						return
					}

					events.onSignal(signal)
					break
				}
			}
		}

		ws.onerror = () => {
			if (destroyed) {
				return
			}

			events.onError(new Error('WebSocket signaling error'))
		}

		return {
			sendSignal,

			destroy() {
				if (destroyed) {
					return
				}

				destroyed = true
				ws?.close()
				ws = null
			},
		}
	}
}