import { describe, expect, it } from 'vitest'
import { SignalingRoom } from '../src/do/SignalingRoom'
import { MemoryStorage } from './fakes'

class FakeWebSocket {
  sent: string[] = []
  closed = false
  private attachment: unknown = null

  send(data: string) {
    if (this.closed) {
      throw new Error('WebSocket is closed')
    }
    this.sent.push(data)
  }

  close() {
    this.closed = true
  }

  serializeAttachment(value: unknown) {
    this.attachment = JSON.parse(JSON.stringify(value))
  }

  deserializeAttachment() {
    return this.attachment
  }
}

class FakeHibernationState {
  readonly storage = new MemoryStorage()
  private readonly sockets: FakeWebSocket[] = []

  acceptWebSocket(ws: unknown) {
    this.sockets.push(ws as FakeWebSocket)
  }

  getWebSockets(): unknown[] {
    return this.sockets.filter((socket) => !socket.closed)
  }

  async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
    return await callback()
  }
}

const json = (ws: FakeWebSocket, index = -1): Record<string, unknown> => {
  const raw = index === -1 ? ws.sent[ws.sent.length - 1] : ws.sent[index]
  return JSON.parse(raw)
}

const allMessages = (ws: FakeWebSocket): Record<string, unknown>[] => ws.sent.map((value) => JSON.parse(value))

const connectPeer = async (
  room: SignalingRoom,
  state: FakeHibernationState,
  peerId: string,
  roomId = 'test-room',
) => {
  const ws = new FakeWebSocket()
  state.acceptWebSocket(ws)

  await room.webSocketMessage(
    ws as unknown as WebSocket,
    JSON.stringify({ type: 'join', roomId, peerId }),
  )

  return ws
}

const simulateHibernation = (state: FakeHibernationState): SignalingRoom => new SignalingRoom(state as never)

describe('SignalingRoom (Hibernation API)', () => {
  it('first peer becomes leader and receives room-state', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const ws = await connectPeer(room, state, 'peer-a')

    const msg = json(ws)
    expect(msg.type).toBe('room-state')
    expect(msg.leaderPeerId).toBe('peer-a')
    expect(msg.epoch).toBe(1)
    expect(msg.peers).toEqual(['peer-a'])
  })

  it('second peer joins and both receive updated room-state', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const wsA = await connectPeer(room, state, 'peer-a')
    const wsB = await connectPeer(room, state, 'peer-b')

    const msgsA = allMessages(wsA)
    expect(msgsA).toHaveLength(2)
    expect(msgsA[1].peers).toEqual(['peer-a', 'peer-b'])

    const lastB = json(wsB)
    expect(lastB.type).toBe('room-state')
    expect(lastB.leaderPeerId).toBe('peer-a')
    expect(lastB.peers).toEqual(['peer-a', 'peer-b'])
  })

  it('leader leaving triggers leader-changed to remaining peer', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const wsA = await connectPeer(room, state, 'peer-a')
    const wsB = await connectPeer(room, state, 'peer-b')
    wsB.sent.length = 0

    await room.webSocketClose(wsA as unknown as WebSocket, 1000, '', true)

    const msg = json(wsB)
    expect(msg.type).toBe('leader-changed')
    expect(msg.leaderPeerId).toBe('peer-b')
    expect(msg.epoch).toBe(2)
  })

  it('non-leader leaving broadcasts updated room-state', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const wsA = await connectPeer(room, state, 'peer-a')
    await connectPeer(room, state, 'peer-b')
    const wsC = await connectPeer(room, state, 'peer-c')
    wsA.sent.length = 0
    wsC.sent.length = 0

    await room.webSocketMessage(
      wsC as unknown as WebSocket,
      JSON.stringify({ type: 'bye', roomId: 'test-room', peerId: 'peer-c' }),
    )

    const msg = json(wsA)
    expect(msg.type).toBe('room-state')
    expect(msg.peers).toEqual(['peer-a', 'peer-b'])
    expect(msg.leaderPeerId).toBe('peer-a')
  })

  it('relays offer/answer/ice-candidate to target peer', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const wsA = await connectPeer(room, state, 'peer-a')
    const wsB = await connectPeer(room, state, 'peer-b')
    wsA.sent.length = 0
    wsB.sent.length = 0

    await room.webSocketMessage(
      wsA as unknown as WebSocket,
      JSON.stringify({ type: 'offer', epoch: 1, from: 'peer-a', to: 'peer-b', sdp: 'test-sdp' }),
    )

    expect(wsB.sent).toHaveLength(1)
    const relayed = json(wsB)
    expect(relayed.type).toBe('offer')
    expect(relayed.from).toBe('peer-a')
    expect(relayed.sdp).toBe('test-sdp')
    expect(wsA.sent).toHaveLength(0)
  })

  it('relays server-leaving to all other peers', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const wsA = await connectPeer(room, state, 'peer-a')
    const wsB = await connectPeer(room, state, 'peer-b')
    wsA.sent.length = 0
    wsB.sent.length = 0

    await room.webSocketMessage(
      wsA as unknown as WebSocket,
      JSON.stringify({ type: 'server-leaving', roomId: 'test-room', from: 'peer-a', ts: Date.now() }),
    )

    expect(wsB.sent).toHaveLength(1)
    const relayed = json(wsB)
    expect(relayed.type).toBe('server-leaving')
    expect(relayed.from).toBe('peer-a')
    expect(wsA.sent).toHaveLength(0)
  })

  it('survives hibernation and reconstructs state from attachments', async () => {
    const state = new FakeHibernationState()
    const room1 = new SignalingRoom(state as never)

    const wsA = await connectPeer(room1, state, 'peer-a')
    const wsB = await connectPeer(room1, state, 'peer-b')
    wsA.sent.length = 0
    wsB.sent.length = 0

    const room2 = simulateHibernation(state)

    await room2.webSocketMessage(
      wsA as unknown as WebSocket,
      JSON.stringify({ type: 'offer', epoch: 1, from: 'peer-a', to: 'peer-b', sdp: 'post-wake' }),
    )

    expect(wsB.sent).toHaveLength(1)
    expect(json(wsB).sdp).toBe('post-wake')
  })

  it('rejoin preserves original joinedAt and closes stale socket', async () => {
    const state = new FakeHibernationState()
    const room = new SignalingRoom(state as never)

    const wsA = await connectPeer(room, state, 'peer-a')
    await connectPeer(room, state, 'peer-b')

    const wsA2 = new FakeWebSocket()
    state.acceptWebSocket(wsA2)

    await room.webSocketMessage(
      wsA2 as unknown as WebSocket,
      JSON.stringify({ type: 'rejoin', roomId: 'test-room', peerId: 'peer-a' }),
    )

    expect(wsA.closed).toBe(true)

    const msg = json(wsA2)
    expect(msg.type).toBe('room-state')
    expect(msg.leaderPeerId).toBe('peer-a')
  })
})
