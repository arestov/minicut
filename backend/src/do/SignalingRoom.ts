import type { DurableObjectStateLike } from '../contracts'

interface PeerAttachment {
  peerId: string
  joinedAt: number
  epoch: number
  leaderPeerId: string | null
  roomId: string | null
}

interface PeerInfo {
  peerId: string
  socket: WebSocket
  joinedAt: number
}

interface HibernatableWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

export class SignalingRoom {
  private state: DurableObjectStateLike
  private peers: Map<string, PeerInfo> | null = null
  private leaderPeerId: string | null = null
  private epoch = 1
  private roomId: string | null = null

  constructor(state: DurableObjectStateLike) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade')
      if (typeof upgradeHeader !== 'string' || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 })
      }

      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      if (typeof this.state.acceptWebSocket === 'function') {
        this.state.acceptWebSocket(server)
      } else {
        server.accept?.()
        this.bindSocket(server)
      }

      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') {
      return
    }

    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }

    this.ensureState()

    const type = String(msg.type ?? '')

    if (type === 'join' || type === 'rejoin') {
      const peerId = String(msg.peerId ?? '')
      if (!peerId) {
        return
      }

      const nextRoomId = typeof msg.roomId === 'string' ? msg.roomId : null
      if (!nextRoomId) {
        return
      }

      if (!this.roomId) {
        this.roomId = nextRoomId
      } else if (this.roomId !== nextRoomId) {
        return
      }

      const existing = this.peers?.get(peerId)
      if (existing && existing.socket !== ws) {
        try {
          existing.socket.close()
        } catch {
          // noop
        }
      }

      this.peers?.set(peerId, {
        peerId,
        socket: ws,
        joinedAt: existing?.joinedAt ?? Date.now(),
      })

      if (!this.leaderPeerId || !this.peers?.has(this.leaderPeerId)) {
        this.leaderPeerId = peerId
      }

      this.syncAttachments()
      this.broadcastRoomState()
      return
    }

    if (type === 'bye') {
      const peerId = this.getPeerId(ws)
      if (peerId) {
        this.removePeer(peerId, ws)
      }
      return
    }

    if (type === 'ping') {
      const peerId = this.getPeerId(ws)
      if (!peerId || (typeof msg.roomId === 'string' && msg.roomId !== this.roomId)) {
        return
      }

      this.sendTo(ws, {
        type: 'pong',
        roomId: this.roomId,
        peerId,
        ts: Date.now(),
      })
      return
    }

    if (type === 'offer' || type === 'answer' || type === 'ice-candidate' || type === 'server-leaving') {
      if (typeof msg.roomId !== 'string' || msg.roomId !== this.roomId) {
        return
      }

      const messageEpoch = Number(msg.epoch)
      if (!Number.isFinite(messageEpoch) || messageEpoch !== this.epoch) {
        return
      }

      const from = String(msg.from ?? '')
      if (!from) {
        return
      }
      const senderPeerId = this.getPeerId(ws)
      if (!senderPeerId || senderPeerId !== from) {
        return
      }

      if (type === 'server-leaving') {
        for (const peer of this.peers?.values() ?? []) {
          if (peer.peerId !== from) {
            this.sendTo(peer.socket, msg)
          }
        }
        return
      }

      const target = String(msg.to ?? '')
      if (!target) {
        return
      }

      const targetPeer = this.peers?.get(target)
      if (targetPeer) {
        this.sendTo(targetPeer.socket, msg)
      }
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    this.ensureState()
    const peerId = this.getPeerId(ws)
    if (peerId) {
      this.removePeer(peerId, ws)
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    this.ensureState()
    const peerId = this.getPeerId(ws)
    if (peerId) {
      this.removePeer(peerId, ws)
    }
  }

  private bindSocket(ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      void this.webSocketMessage(ws, event.data as string | ArrayBuffer)
    })
    ws.addEventListener('close', (event) => {
      void this.webSocketClose(ws, event.code, event.reason, event.wasClean)
    })
    ws.addEventListener('error', () => {
      void this.webSocketError(ws, new Error('socket error'))
    })
  }

  private ensureState() {
    if (this.peers) {
      return
    }

    this.peers = new Map()
    const sockets = this.state.getWebSockets?.() ?? []
    let sharedRestored = false

    for (const ws of sockets) {
      const att = this.getSocketAttachment(ws)
      if (!att?.peerId) {
        continue
      }

      this.peers.set(att.peerId, {
        peerId: att.peerId,
        socket: ws,
        joinedAt: att.joinedAt,
      })

      if (!sharedRestored) {
        this.epoch = att.epoch
        this.leaderPeerId = att.leaderPeerId
        this.roomId = att.roomId
        sharedRestored = true
      }
    }
  }

  private getSocketAttachment(ws: WebSocket): PeerAttachment | null {
    const candidate = ws as Partial<HibernatableWebSocket>
    if (typeof candidate.deserializeAttachment !== 'function') {
      return null
    }

    let raw: unknown
    try {
      raw = candidate.deserializeAttachment()
    } catch {
      return null
    }
    if (!raw || typeof raw !== 'object') {
      return null
    }

    return raw as PeerAttachment
  }

  private getPeerId(ws: WebSocket): string | null {
    const att = this.getSocketAttachment(ws)
    if (att?.peerId) {
      return att.peerId
    }

    for (const [peerId, peer] of this.peers?.entries() ?? []) {
      if (peer.socket === ws) {
        return peerId
      }
    }

    return att?.peerId ?? null
  }

  private syncAttachments() {
    const shared = {
      epoch: this.epoch,
      leaderPeerId: this.leaderPeerId,
      roomId: this.roomId,
    }

    for (const peer of this.peers?.values() ?? []) {
	  const candidate = peer.socket as Partial<HibernatableWebSocket>
	  if (typeof candidate.serializeAttachment !== 'function') {
	    continue
	  }

    try {
      candidate.serializeAttachment({
          peerId: peer.peerId,
          joinedAt: peer.joinedAt,
          ...shared,
      })
    } catch {
      // socket may be in transient close state
    }
    }
  }

  private removePeer(peerId: string, socket?: WebSocket) {
    const current = this.peers?.get(peerId)
    if (socket && current?.socket !== socket) {
      return
    }

    this.peers?.delete(peerId)

    if (this.leaderPeerId === peerId) {
      this.leaderPeerId = this.pickNextLeader()
      this.epoch += 1
      this.syncAttachments()
      this.broadcast({
        type: 'leader-changed',
        epoch: this.epoch,
        leaderPeerId: this.leaderPeerId,
      })
      return
    }

    if ((this.peers?.size ?? 0) > 0) {
      this.syncAttachments()
      this.broadcastRoomState()
    }
  }

  private pickNextLeader(): string | null {
    const remaining = [...(this.peers?.values() ?? [])].sort((a, b) => a.joinedAt - b.joinedAt)
    return remaining[0]?.peerId ?? null
  }

  private broadcastRoomState() {
    this.broadcast({
      type: 'room-state',
      roomId: this.roomId,
      epoch: this.epoch,
      leaderPeerId: this.leaderPeerId,
      peers: [...(this.peers?.keys() ?? [])],
    })
  }

  private broadcast(msg: Record<string, unknown>) {
    const payload = JSON.stringify(msg)
    for (const peer of this.peers?.values() ?? []) {
      try {
        peer.socket.send(payload)
      } catch (error) {
        console.warn('[minicut:signal-room] broadcast send failed', {
          roomId: this.roomId,
          peerId: peer.peerId,
          error,
        })
      }
    }
  }

  private sendTo(ws: WebSocket, msg: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(msg))
    } catch (error) {
      console.warn('[minicut:signal-room] direct send failed', {
        roomId: this.roomId,
        targetPeerId: this.getPeerId(ws),
        type: msg.type,
        error,
      })
    }
  }
}
