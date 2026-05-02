import { describe, expect, test, vi } from 'vitest'
import { createEmptyRegistry } from '../domain/createProject'
import { CMD, MSG, PATCH, type Command, type DispatchResult, type HistoryState, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import type { EditorAuthorityClient, PatchListener } from '../worker/authorityClient'
import { createP2PAuthorityAdapter } from './P2PAuthorityAdapter'
import type { P2PTransportLike, PageP2PManager, PageP2PManagerConfig, PageP2PManagerEvents } from './PageP2PManager'

const createRegistryEnvelope = (snapshot: ProjectRegistry): PatchEnvelope => ({
	projectId: snapshot.activeProjectId ?? '__workspace__',
	version: 1,
	patches: [{ c: PATCH.REGISTRY_SET, p: { registry: snapshot } }],
})

class FakeAuthorityClient implements EditorAuthorityClient {
	snapshot: ProjectRegistry
	readonly history: HistoryState = { canUndo: false, canRedo: false }
	readonly listeners = new Set<PatchListener>()

	constructor(snapshot: ProjectRegistry = createEmptyRegistry()) {
		this.snapshot = snapshot
	}

	getSnapshot = vi.fn(() => this.snapshot)
	getHistoryState = vi.fn(() => this.history)
	dispatch = vi.fn((command: Command): DispatchResult => ({
		envelope: createRegistryEnvelope(this.snapshot),
		createdIds: command.c === CMD.PROJECT_CREATE ? { projectId: 'project:1' } : undefined,
	}))
	undo = vi.fn(() => null)
	redo = vi.fn(() => null)
	destroy = vi.fn(() => {
		this.listeners.clear()
	})

	subscribe(listener: PatchListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	emitPatch(envelope: PatchEnvelope): void {
		for (const listener of this.listeners) {
			listener(envelope)
		}
	}
}

class FakeRestorableAuthorityClient extends FakeAuthorityClient {
	replaceSnapshot = vi.fn(async (snapshot: ProjectRegistry) => {
		this.snapshot = structuredClone(snapshot)
	})
}

const createTransportHarness = () => {
	const listeners = new Set<(message: WireMessage) => void>()
	const sent: WireMessage[] = []
	const destroy = vi.fn(() => {
		listeners.clear()
	})

	const transport: P2PTransportLike = {
		send(message) {
			sent.push(message)
		},
		listen(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		destroy,
	}

	return {
		transport,
		sent,
		destroy,
		emit(message: WireMessage) {
			for (const listener of listeners) {
				listener(message)
			}
		},
	}
}

const createManagerHarness = () => {
	let events: PageP2PManagerEvents | null = null
	let role: 'server' | 'client' | 'undecided' = 'undecided'
	const destroy = vi.fn()

	const manager: PageP2PManager = {
		get role() {
			return role
		},
		get peerId() {
			return 'peer-local'
		},
		destroy,
	}

	const factory = vi.fn((_config: PageP2PManagerConfig, managerEvents: PageP2PManagerEvents) => {
		events = managerEvents
		return manager
	})

	return {
		factory,
		destroy,
		emitBecomeServer() {
			role = 'server'
			events?.onBecomeServer()
		},
		emitBecomeClient(transport: P2PTransportLike) {
			role = 'client'
			events?.onBecomeClient(transport)
		},
		emitSessionLost(reason = 'server-gone') {
			role = 'undecided'
			events?.onSessionLost(reason)
		},
	}
}

describe('P2PAuthorityAdapter', () => {
	test('queues requests while role is undecided and flushes after server activation', async () => {
		const manager = createManagerHarness()
		const local = new FakeAuthorityClient()
		const createLocalAuthority = vi.fn(() => local)
		const adapter = createP2PAuthorityAdapter({
			roomId: 'room-1',
			signalUrl: 'http://localhost:8787',
			workerUrl: 'http://localhost/sharedWorker.js',
			createManager: manager.factory,
			createLocalAuthority,
		})

		const snapshotPromise = adapter.getSnapshot()
		expect(local.getSnapshot).not.toHaveBeenCalled()

		manager.emitBecomeServer()
		await expect(snapshotPromise).resolves.toEqual(local.snapshot)
		expect(createLocalAuthority).toHaveBeenCalledTimes(1)

		const patchListener = vi.fn()
		adapter.subscribe(patchListener)
		local.emitPatch(createRegistryEnvelope(local.snapshot))
		expect(patchListener).toHaveBeenCalledTimes(1)

		adapter.destroy()
		expect(manager.destroy).toHaveBeenCalledTimes(1)
	})

	test('routes authority requests over DataChannel transport in client mode', async () => {
		const manager = createManagerHarness()
		const transport = createTransportHarness()
		const adapter = createP2PAuthorityAdapter({
			roomId: 'room-1',
			signalUrl: 'http://localhost:8787',
			workerUrl: 'http://localhost/sharedWorker.js',
			createManager: manager.factory,
		})

		const snapshotPromise = adapter.getSnapshot()
		manager.emitBecomeClient(transport.transport)

		expect(transport.sent).toHaveLength(1)
		expect(transport.sent[0].m).toBe(MSG.SNAPSHOT_REQUEST)
		expect(transport.sent[0].requestId).toBeTypeOf('string')

		const requestId = String(transport.sent[0].requestId)
		const snapshot = createEmptyRegistry()
		transport.emit({
			m: MSG.SNAPSHOT,
			requestId,
			p: snapshot,
		})

		await expect(snapshotPromise).resolves.toEqual(snapshot)
		adapter.destroy()
		expect(transport.destroy).toHaveBeenCalledTimes(1)
	})

	test('rejects in-flight client requests on session loss and recovers on server role', async () => {
		const manager = createManagerHarness()
		const transport = createTransportHarness()
		const local = new FakeAuthorityClient()
		const createLocalAuthority = vi.fn(() => local)
		const onSessionLost = vi.fn()

		const adapter = createP2PAuthorityAdapter({
			roomId: 'room-1',
			signalUrl: 'http://localhost:8787',
			workerUrl: 'http://localhost/sharedWorker.js',
			createManager: manager.factory,
			createLocalAuthority,
			onSessionLost,
		})

		manager.emitBecomeClient(transport.transport)
		const dispatchPromise = adapter.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
		expect(transport.sent).toHaveLength(1)
		expect(transport.sent[0].m).toBe(MSG.COMMAND)

		manager.emitSessionLost('server-gone')
		await expect(dispatchPromise).rejects.toThrow(/P2P (session lost|authority request cancelled)/)
		expect(onSessionLost).toHaveBeenCalledWith('server-gone')

		manager.emitBecomeServer()
		await expect(adapter.getSnapshot()).resolves.toEqual(local.snapshot)
		expect(createLocalAuthority).toHaveBeenCalledTimes(1)
	})

	test('hydrates local authority snapshot when client fails over to server', async () => {
		const manager = createManagerHarness()
		const transport = createTransportHarness()
		const local = new FakeRestorableAuthorityClient()
		const createLocalAuthority = vi.fn(() => local)

		const adapter = createP2PAuthorityAdapter({
			roomId: 'room-1',
			signalUrl: 'http://localhost:8787',
			workerUrl: 'http://localhost/sharedWorker.js',
			createManager: manager.factory,
			createLocalAuthority,
		})

		manager.emitBecomeClient(transport.transport)
		const remoteSnapshot = createEmptyRegistry()
		const snapshotPromise = adapter.getSnapshot()
		const requestId = String(transport.sent[0].requestId)
		transport.emit({
			m: MSG.SNAPSHOT,
			requestId,
			p: remoteSnapshot,
		})
		await expect(snapshotPromise).resolves.toEqual(remoteSnapshot)

		manager.emitSessionLost('server-gone')
		manager.emitBecomeServer()
		await Promise.resolve()

		expect(local.replaceSnapshot).toHaveBeenCalledWith(remoteSnapshot)
		await expect(adapter.getSnapshot()).resolves.toEqual(remoteSnapshot)
	})

	test('rejects queued calls when role resolution timeout is exceeded', async () => {
		vi.useFakeTimers()
		const manager = createManagerHarness()
		const adapter = createP2PAuthorityAdapter({
			roomId: 'room-timeout',
			signalUrl: 'http://localhost:8787',
			workerUrl: 'http://localhost/sharedWorker.js',
			createManager: manager.factory,
			pendingCallTimeoutMs: 100,
		})

		const pendingSnapshot = adapter.getSnapshot()
			const rejection = expect(pendingSnapshot).rejects.toThrow('P2P authority role resolution timed out')
		await vi.advanceTimersByTimeAsync(120)

			await rejection
		adapter.destroy()
	})
})
