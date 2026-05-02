import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SignalMessage } from './types'

type Handler = (...args: unknown[]) => void

class MockWebSocket {
	static OPEN = 1
	static CLOSED = 3
	static instances: MockWebSocket[] = []

	readyState = MockWebSocket.OPEN
	sent: string[] = []
	onopen: Handler | null = null
	onmessage: Handler | null = null
	onerror: Handler | null = null
	onclose: Handler | null = null

	constructor(public url: string) {
		MockWebSocket.instances.push(this)
	}

	send(data: string): void {
		this.sent.push(data)
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED
	}

	static reset(): void {
		MockWebSocket.instances = []
	}

	simulateOpen(): void {
		this.readyState = MockWebSocket.OPEN
		this.onopen?.({})
	}

	simulateMessage(data: Record<string, unknown>): void {
		this.onmessage?.({ data: JSON.stringify(data) })
	}

	simulateError(): void {
		this.onerror?.({})
	}

	simulateClose(): void {
		this.readyState = MockWebSocket.CLOSED
		this.onclose?.({})
	}
}

let originalWebSocket: typeof globalThis.WebSocket

beforeEach(() => {
	MockWebSocket.reset()
	originalWebSocket = globalThis.WebSocket
	vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
})

afterEach(() => {
	globalThis.WebSocket = originalWebSocket
	vi.useRealTimers()
})

describe('createDoSignalingFactory', () => {
	const createEvents = () => ({
		onMemberJoined: vi.fn(),
		onMemberLeft: vi.fn(),
		onSignal: vi.fn(),
		onLeaderAssigned: vi.fn(),
		onConnected: vi.fn(),
		onError: vi.fn(),
	})

	test('opens ws and sends join on connect', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'test-room',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})

		const ws = MockWebSocket.instances[0]
		expect(ws.url).toBe('ws://127.0.0.1:8790/api/signal/test-room')
		ws.simulateOpen()
		expect(JSON.parse(ws.sent[0])).toEqual({ type: 'join', roomId: 'test-room', peerId: 'peer-a' })
	})

	test('handles room-state membership and leader assignment', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})
		const ws = MockWebSocket.instances[0]
		ws.simulateOpen()
		ws.simulateMessage({
			type: 'room-state',
			roomId: 'room-1',
			epoch: 1,
			leaderPeerId: 'peer-a',
			peers: ['peer-a', 'peer-b'],
		})

		expect(events.onMemberJoined).toHaveBeenCalledWith('peer-b', 0)
		expect(events.onLeaderAssigned).toHaveBeenCalledWith('peer-a', 1)
		expect(events.onConnected).toHaveBeenCalledTimes(1)
	})

	test('emits connected only once across repeated room-state updates', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})
		const ws = MockWebSocket.instances[0]
		ws.simulateOpen()
		ws.simulateMessage({
			type: 'room-state',
			epoch: 1,
			leaderPeerId: 'peer-a',
			peers: ['peer-a'],
		})
		ws.simulateMessage({
			type: 'room-state',
			epoch: 2,
			leaderPeerId: 'peer-a',
			peers: ['peer-a', 'peer-b'],
		})

		expect(events.onConnected).toHaveBeenCalledTimes(1)
	})

	test('ignores stale leader-changed epochs', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})
		const ws = MockWebSocket.instances[0]
		ws.simulateOpen()

		ws.simulateMessage({
			type: 'room-state',
			epoch: 3,
			leaderPeerId: 'peer-a',
			peers: ['peer-a', 'peer-b'],
		})
		ws.simulateMessage({
			type: 'leader-changed',
			epoch: 2,
			leaderPeerId: 'peer-b',
		})

		expect(events.onLeaderAssigned).toHaveBeenCalledTimes(1)
		expect(events.onLeaderAssigned).toHaveBeenCalledWith('peer-a', 3)
	})

	test('filters self and foreign targeted signals', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})
		const ws = MockWebSocket.instances[0]
		ws.simulateOpen()

		ws.simulateMessage({ type: 'offer', from: 'peer-a', to: 'peer-b', sdp: { type: 'offer', sdp: 'x' } })
		ws.simulateMessage({ type: 'answer', from: 'peer-b', to: 'peer-c', sdp: { type: 'answer', sdp: 'y' } })
		expect(events.onSignal).not.toHaveBeenCalled()

		ws.simulateMessage({
			type: 'offer',
			from: 'peer-b',
			to: 'peer-a',
			sdp: { type: 'offer', sdp: 'ok' },
			ts: 123,
		})
		expect(events.onSignal).toHaveBeenCalledTimes(1)
		expect(events.onSignal.mock.calls[0][0]).toMatchObject({ kind: 'offer', fromPeerId: 'peer-b', toPeerId: 'peer-a' })
	})

	test('sendSignal and sendBye use do wire protocol', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		const signaling = createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-bye',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})
		const ws = MockWebSocket.instances[0]
		ws.simulateOpen()
		ws.sent.length = 0

		signaling.sendSignal({
			kind: 'ice-candidate',
			roomId: 'room-bye',
			fromPeerId: 'peer-a',
			toPeerId: 'peer-b',
			candidate: { candidate: 'candidate:1' } as RTCIceCandidateInit,
			ts: 100,
		} as SignalMessage)
		signaling.sendBye?.()

		expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'ice-candidate', from: 'peer-a', to: 'peer-b' })
		expect(JSON.parse(ws.sent[1])).toEqual({ type: 'bye', roomId: 'room-bye', peerId: 'peer-a' })
	})

	test('retries when ws closes before room-state', async () => {
		vi.useFakeTimers()
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})

		const ws1 = MockWebSocket.instances[0]
		ws1.simulateOpen()
		ws1.simulateClose()

		expect(events.onError).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(310)
		expect(MockWebSocket.instances.length).toBe(2)
	})

	test('fires error after retry budget is exhausted', async () => {
		vi.useFakeTimers()
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})

		for (let index = 0; index < 5; index += 1) {
			const ws = MockWebSocket.instances[index]
			ws.simulateError()
			if (index < 4) {
				await vi.advanceTimersByTimeAsync(300 * 2 ** index + 10)
			}
		}

		expect(events.onError).toHaveBeenCalledTimes(1)
	})

	test('does not schedule duplicate retries when error is followed by close', async () => {
		vi.useFakeTimers()
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})

		const ws = MockWebSocket.instances[0]
		ws.simulateError()
		ws.simulateClose()

		await vi.advanceTimersByTimeAsync(310)
		expect(MockWebSocket.instances).toHaveLength(2)
		expect(events.onError).not.toHaveBeenCalled()
	})

	test('ignores late events after destroy', async () => {
		const { createDoSignalingFactory } = await import('./BridgeSignaling')
		const events = createEvents()
		const signaling = createDoSignalingFactory('ws://127.0.0.1:8790')({
			roomId: 'room-1',
			peerId: 'peer-a',
			joinedAt: Date.now(),
			events,
		})
		const ws = MockWebSocket.instances[0]
		signaling.destroy()
		ws.simulateMessage({
			type: 'room-state',
			rm: 'room-1',
			epoch: 1,
			leaderPeerId: 'peer-a',
			peers: ['peer-a'],
		})

		expect(events.onConnected).not.toHaveBeenCalled()
	})
})