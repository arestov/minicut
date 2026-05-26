const ports = new Map()
const rooms = new Map()

const ensureRoom = (roomId) => {
	let room = rooms.get(roomId)
	if (!room) {
		room = { ownerTabId: null, generation: 0, pending: [] }
		rooms.set(roomId, room)
	}
	return room
}

const send = (tabId, message) => {
	const entry = ports.get(tabId)
	if (entry) entry.port.postMessage(message)
}

const elect = (roomId) => {
	const room = ensureRoom(roomId)
	if (room.ownerTabId) return
	for (const [tabId, entry] of ports) {
		if (entry.roomId === roomId && entry.canHostWebRtc) {
			room.ownerTabId = tabId
			room.generation += 1
			send(tabId, {
				type: 'ATTACH_WEBRTC',
				roomId,
				generation: room.generation,
			})
			return
		}
	}
}

const broadcastView = (roomId, message) => {
	for (const [tabId, entry] of ports) {
		if (entry.roomId === roomId) send(tabId, message)
	}
}

self.onconnect = (event) => {
	const port = event.ports[0]
	port.onmessage = (ev) => {
		const message = ev.data
		if (message.type === 'TAB_HELLO') {
			ports.set(message.tabId, {
				port,
				roomId: message.roomId,
				canHostWebRtc: Boolean(message.canHostWebRtc),
			})
			elect(message.roomId)
			return
		}

		const entry = ports.get(message.tabId)
		if (!entry) return
		const room = ensureRoom(entry.roomId)

		if (message.type === 'OWNER_ATTACHED') {
			if (
				room.ownerTabId === message.tabId &&
				room.generation === message.generation
			) {
				broadcastView(entry.roomId, {
					type: 'OWNER_READY',
					roomId: entry.roomId,
					ownerTabId: message.tabId,
					generation: message.generation,
				})
				for (const pending of room.pending.splice(0)) {
					send(message.tabId, {
						type: 'SEND_PACKET',
						roomId: entry.roomId,
						generation: message.generation,
						packet: pending.packet,
						targetPeerId: pending.targetPeerId,
					})
				}
			}
			return
		}

		if (message.type === 'SEND_FROM_WORKER') {
			if (!room.ownerTabId) {
				room.pending.push({
					packet: message.packet,
					targetPeerId: message.targetPeerId,
				})
				elect(entry.roomId)
				return
			}
			send(room.ownerTabId, {
				type: 'SEND_PACKET',
				roomId: entry.roomId,
				generation: room.generation,
				packet: message.packet,
				targetPeerId: message.targetPeerId,
			})
			return
		}

		if (message.type === 'PACKET_RECEIVED') {
			broadcastView(entry.roomId, {
				type: 'PACKET_RECEIVED',
				roomId: entry.roomId,
				sourcePeerId: message.sourcePeerId,
				packet: message.packet,
			})
			return
		}

		if (message.type === 'PEER_ATTACHED') {
			broadcastView(entry.roomId, {
				type: 'PEER_ATTACHED',
				roomId: entry.roomId,
				peerId: message.peerId,
			})
		}
	}
	port.start()
}
