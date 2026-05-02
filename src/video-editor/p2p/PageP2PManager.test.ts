import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BridgeSignalingEvents, BridgeSignalingFactory } from './BridgeSignaling'
import { createDefaultRtcConfig, createPageP2PManager } from './PageP2PManager'
import type { SignalMessage } from './types'

type Handler = (...args: unknown[]) => void

const flushMicrotasks = async (count = 4): Promise<void> => {
	for (let index = 0; index < count; index += 1) {
		await Promise.resolve()
	}
}

class MockDataChannel {
	readyState = 'connecting'
	label: string
	sent: unknown[] = []
	onopen: Handler | null = null
	onclose: Handler | null = null
	onerror: Handler | null = null
	onmessage: Handler | null = null

	constructor(label = 'minicut-authority') {
		this.label = label
	}

	send(data: unknown): void {
		this.sent.push(data)
	}

	close(): void {
		this.readyState = 'closed'
	}

	simulateOpen(): void {
		this.readyState = 'open'
		this.onopen?.({})
	}

	simulateClose(): void {
		this.readyState = 'closed'
		this.onclose?.({})
	}

	simulateMessage(data: unknown): void {
		this.onmessage?.({ data: JSON.stringify(data) })
	}

	simulateRawMessage(data: unknown): void {
		this.onmessage?.({ data })
	}
}

class MockRTCPeerConnection {
	static instances: MockRTCPeerConnection[] = []

	connectionState: RTCPeerConnectionState = 'new'
	localDescription: { toJSON: () => Record<string, unknown> } | null = null
	onicecandidate: Handler | null = null
	ondatachannel: Handler | null = null
	onconnectionstatechange: Handler | null = null
	createdChannels: MockDataChannel[] = []

	constructor() {
		MockRTCPeerConnection.instances.push(this)
	}

	createDataChannel(label?: string): RTCDataChannel {
		const dc = new MockDataChannel(label)
		this.createdChannels.push(dc)
		return dc as unknown as RTCDataChannel
	}

	simulateDataChannel(label = 'minicut-authority'): MockDataChannel {
		const dc = new MockDataChannel(label)
		this.ondatachannel?.({ channel: dc })
		return dc
	}

	async createOffer(): Promise<RTCSessionDescriptionInit> {
		return { type: 'offer', sdp: 'offer-sdp' }
	}

	async createAnswer(): Promise<RTCSessionDescriptionInit> {
		return { type: 'answer', sdp: 'answer-sdp' }
	}

	async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
		this.localDescription = { toJSON: () => desc as Record<string, unknown> }
	}

	async setRemoteDescription(): Promise<void> {
		return
	}

	async addIceCandidate(): Promise<void> {
		return
	}

	close(): void {
		this.connectionState = 'closed'
	}

	simulateConnectionState(state: RTCPeerConnectionState): void {
		this.connectionState = state
		this.onconnectionstatechange?.({})
	}
}

class MockMessagePort {
	onmessage: ((event: { data: unknown }) => void) | null = null
	sent: unknown[] = []
	started = false

	start(): void {
		this.started = true
	}

	postMessage(data: unknown): void {
		this.sent.push(data)
	}

	close(): void {
		this.started = false
	}
}

class MockSharedWorker {
	static instances: MockSharedWorker[] = []
	port = new MockMessagePort()

	constructor() {
		MockSharedWorker.instances.push(this)
	}
}

const createSignalingHarness = () => {
	let eventsRef: BridgeSignalingEvents | null = null
	const sent: SignalMessage[] = []
	const sendBye = vi.fn()
	const destroy = vi.fn()

	const factory: BridgeSignalingFactory = ({ events }) => {
		eventsRef = events
		return {
			sendSignal(msg) {
				sent.push(msg)
			},
			sendBye,
			destroy,
		}
	}

	return {
		factory,
		sent,
		sendBye,
		destroy,
		emitMemberLeft(peerId: string) {
			eventsRef?.onMemberLeft(peerId)
		},
		emitLeader(peerId: string, epoch = 1) {
			eventsRef?.onLeaderAssigned(peerId, epoch)
		},
		emitSignal(msg: SignalMessage) {
			eventsRef?.onSignal(msg)
		},
		emitError(error: unknown) {
			eventsRef?.onError(error)
		},
	}
}

beforeEach(() => {
	MockRTCPeerConnection.instances = []
	MockSharedWorker.instances = []
	vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection as unknown as typeof RTCPeerConnection)
	vi.stubGlobal('RTCSessionDescription', class { constructor(_value: unknown) {} })
	vi.stubGlobal('RTCIceCandidate', class { constructor(_value: unknown) {} })
	vi.stubGlobal('SharedWorker', MockSharedWorker as unknown as typeof SharedWorker)
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('PageP2PManager', () => {
	test('includes TURN relay in default rtc config when provided', () => {
		expect(createDefaultRtcConfig()).toEqual({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		})

		expect(createDefaultRtcConfig({
			urls: ['turn:relay.example.com:3478?transport=udp'],
			username: 'relay-user',
			credential: 'relay-pass',
		})).toEqual({
			iceServers: [
				{ urls: 'stun:stun.l.google.com:19302' },
				{
					urls: ['turn:relay.example.com:3478?transport=udp'],
					username: 'relay-user',
					credential: 'relay-pass',
				},
			],
		})
	})

	test('becomes server when room leader equals local peer', () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader(manager.peerId)
		expect(manager.role).toBe('server')
		expect(events.onBecomeServer).toHaveBeenCalledTimes(1)
		expect(events.onBecomeClient).not.toHaveBeenCalled()

		manager.destroy()
	})

	test('ignores stale leader assignments by epoch', () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader('server-a', 2)
		expect(manager.role).toBe('client')
		expect(MockRTCPeerConnection.instances).toHaveLength(1)

		signaling.emitLeader('server-b', 1)
		expect(MockRTCPeerConnection.instances).toHaveLength(1)
		expect(events.onBecomeClient).not.toHaveBeenCalled()

		manager.destroy()
	})

	test('becomes client and relays transport messages over data channel', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader('remote-server')
		expect(manager.role).toBe('client')
		expect(MockRTCPeerConnection.instances).toHaveLength(1)

		await Promise.resolve()
		const dc = MockRTCPeerConnection.instances[0].createdChannels[0]
		dc.simulateOpen()

		expect(events.onBecomeClient).toHaveBeenCalledTimes(1)
		const transport = events.onBecomeClient.mock.calls[0][0]
		const received: unknown[] = []
		transport.listen((message: unknown) => {
			received.push(message)
		})

		transport.send({ m: -1, p: { test: true } })
		expect(JSON.parse(dc.sent[0])).toMatchObject({ m: -1 })

		dc.simulateMessage({ m: -4, p: { ok: true } })
		expect(received).toEqual([{ m: -4, p: { ok: true } }])

		dc.simulateClose()
		expect(events.onSessionLost).toHaveBeenCalledWith('server-gone')

		manager.destroy()
	})

	test('normalizes blob frames on the client resource transport without losing message order', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onClientResourceTransport: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader('remote-server')
		await Promise.resolve()
		const resourceDc = MockRTCPeerConnection.instances[0].createdChannels[1]
		resourceDc.simulateOpen()

		expect(events.onClientResourceTransport).toHaveBeenCalledTimes(1)
		const transport = events.onClientResourceTransport.mock.calls[0][0]
		const received: Array<string | ArrayBuffer> = []
		transport.listen((payload: string | ArrayBuffer) => {
			received.push(payload)
		})

		resourceDc.simulateRawMessage('meta')
		resourceDc.simulateRawMessage(new Blob([new Uint8Array([1, 2, 3])]))
		resourceDc.simulateRawMessage(new Uint8Array([4, 5, 6]))
		await vi.waitFor(() => {
			expect(received).toHaveLength(3)
		})

		expect(received[0]).toBe('meta')
		expect(Array.from(new Uint8Array(received[1] as ArrayBuffer))).toEqual([1, 2, 3])
		expect(Array.from(new Uint8Array(received[2] as ArrayBuffer))).toEqual([4, 5, 6])

		manager.destroy()
	})

	test('ignores signaling errors after client transport is healthy', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader('remote-server')
		await Promise.resolve()
		const dc = MockRTCPeerConnection.instances[0].createdChannels[0]
		dc.simulateOpen()

		signaling.emitError(new Error('signaling closed'))
		expect(events.onError).not.toHaveBeenCalled()
		expect(events.onSessionLost).not.toHaveBeenCalled()

		manager.destroy()
	})

	test('handles incoming offer in server mode and creates worker proxy bridge', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader(manager.peerId)
		signaling.emitSignal({
			kind: 'offer',
			roomId: 'room-1',
			fromPeerId: 'remote-client-1',
			toPeerId: manager.peerId,
			sdp: { type: 'offer', sdp: 'incoming-offer' },
			ts: Date.now(),
		})

		await flushMicrotasks(8)
		expect(MockRTCPeerConnection.instances).toHaveLength(1)

		const pc = MockRTCPeerConnection.instances[0]
		const remoteDc = pc.simulateDataChannel()
		remoteDc.simulateOpen()

		expect(events.onError).not.toHaveBeenCalled()
		expect(MockSharedWorker.instances).toHaveLength(1)
		const answer = signaling.sent.find((message) => message.kind === 'answer')
		expect(answer).toBeTruthy()

		remoteDc.simulateMessage({ m: -1, p: { request: true } })
		expect(MockSharedWorker.instances[0].port.sent[0]).toEqual({ m: -1, p: { request: true } })

		MockSharedWorker.instances[0].port.onmessage?.({ data: { m: -2, p: { snapshot: true } } })
		expect(JSON.parse(remoteDc.sent[0])).toEqual({ m: -2, p: { snapshot: true } })

		manager.destroy()
	})

	test('emits timeout error when client connection remains disconnected', () => {
		vi.useFakeTimers()
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
			connectionTimeoutMs: 10_000,
		}, events)

		signaling.emitLeader('remote-server')
		const pc = MockRTCPeerConnection.instances[0]
		pc.simulateConnectionState('disconnected')

		vi.advanceTimersByTime(9_999)
		expect(events.onError).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'WebRTC connection timed out' }))
	})

	test('reports signaling errors while role is still undecided', () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitError(new Error('signaling down'))
		expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'signaling down' }))
		expect(events.onBecomeServer).not.toHaveBeenCalled()
	})

	test('announces server-leaving before destroy when acting as server', () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader(manager.peerId)
		manager.destroy()

		expect(signaling.sent[0]).toMatchObject({
			kind: 'server-leaving',
			roomId: 'room-1',
			fromPeerId: manager.peerId,
		})
		expect(signaling.sendBye).toHaveBeenCalledTimes(1)
	})

	test('replaces existing peer connection when duplicate offer arrives from same remote peer', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader(manager.peerId)
		signaling.emitSignal({
			kind: 'offer',
			roomId: 'room-1',
			fromPeerId: 'remote-client-1',
			toPeerId: manager.peerId,
			sdp: { type: 'offer', sdp: 'offer-1' },
			ts: Date.now(),
		})
		await flushMicrotasks(8)

		const firstPc = MockRTCPeerConnection.instances[0]
		expect(firstPc.connectionState).toBe('new')

		signaling.emitSignal({
			kind: 'offer',
			roomId: 'room-1',
			fromPeerId: 'remote-client-1',
			toPeerId: manager.peerId,
			sdp: { type: 'offer', sdp: 'offer-2' },
			ts: Date.now(),
		})
		await flushMicrotasks(8)

		expect(MockRTCPeerConnection.instances).toHaveLength(2)
		expect(firstPc.connectionState).toBe('closed')
		expect(events.onError).not.toHaveBeenCalled()

		manager.destroy()
	})

	test('emits session-lost once when leader leaves member set', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader('remote-server')
		await Promise.resolve()
		const dc = MockRTCPeerConnection.instances[0].createdChannels[0]
		dc.simulateOpen()

		signaling.emitMemberLeft('remote-server')
		expect(events.onSessionLost).toHaveBeenCalledTimes(1)
		expect(events.onSessionLost).toHaveBeenCalledWith('server-gone')

		manager.destroy()
	})

	test('switches from server role to client role when newer leader epoch is received', async () => {
		const signaling = createSignalingHarness()
		const events = {
			onBecomeServer: vi.fn(),
			onBecomeClient: vi.fn(),
			onSessionLost: vi.fn(),
			onError: vi.fn(),
		}
		const manager = createPageP2PManager({
			roomId: 'room-1',
			signalUrl: 'ws://127.0.0.1:8790',
			workerUrl: 'http://localhost/sharedWorker.js',
			createSignaling: signaling.factory,
		}, events)

		signaling.emitLeader(manager.peerId, 1)
		signaling.emitSignal({
			kind: 'offer',
			roomId: 'room-1',
			fromPeerId: 'remote-client-1',
			toPeerId: manager.peerId,
			sdp: { type: 'offer', sdp: 'incoming-offer' },
			ts: Date.now(),
		})
		await flushMicrotasks(8)
		const remoteDc = MockRTCPeerConnection.instances[0].simulateDataChannel()
		remoteDc.simulateOpen()
		expect(MockSharedWorker.instances).toHaveLength(1)
		expect(MockSharedWorker.instances[0].port.started).toBe(true)

		signaling.emitLeader('remote-server', 2)
		await Promise.resolve()
		const nextClientPc = MockRTCPeerConnection.instances[MockRTCPeerConnection.instances.length - 1]
		nextClientPc.createdChannels[0]?.simulateOpen()

		expect(manager.role).toBe('client')
		expect(events.onBecomeClient).toHaveBeenCalledTimes(1)
		expect(MockSharedWorker.instances[0].port.started).toBe(false)

		manager.destroy()
	})
})