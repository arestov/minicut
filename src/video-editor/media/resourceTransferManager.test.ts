import { waitFor } from '@testing-library/react'
import type { Entity, ProjectRegistry, ResourceAttrs } from '../domain/types'
import { createMissingResourceData } from '../domain/resourceData'
import { createResourceTransferManager, type RequestMessage } from './resourceTransferManager'
import type { P2PRawTransportLike } from '../p2p/PageP2PManager'

class LinkedRawTransport implements P2PRawTransportLike {
	private listeners = new Set<(data: string | ArrayBuffer) => void>()
	private peer: LinkedRawTransport | null = null

	connect(peer: LinkedRawTransport): void {
		this.peer = peer
	}

	send(data: string | ArrayBuffer): void {
		const payload = typeof data === 'string' ? data : data.slice(0)
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) {
				listener(payload)
			}
		})
	}

	listen(listener: (data: string | ArrayBuffer) => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	destroy(): void {
		this.listeners.clear()
	}
}

const createTransportPair = (): [P2PRawTransportLike, P2PRawTransportLike] => {
	const left = new LinkedRawTransport()
	const right = new LinkedRawTransport()
	left.connect(right)
	right.connect(left)
	return [left, right]
}

const parseRequestMessages = (transport: P2PRawTransportLike): RequestMessage[] => {
	const messages: RequestMessage[] = []
	transport.listen((data) => {
		if (typeof data !== 'string') {
			return
		}

		const parsed = JSON.parse(data) as { type?: string }
		if (parsed.type === 'resource-request') {
			messages.push(parsed as RequestMessage)
		}
	})
	return messages
}

const sendChunk = (
	transport: P2PRawTransportLike,
	message: {
		resourceId: string
		index: number
		start: number
		end: number
		totalSize: number
		reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'
	},
	payload: string,
): void => {
	transport.send(JSON.stringify({
		type: 'resource-chunk-meta',
		resourceId: message.resourceId,
		index: message.index,
		start: message.start,
		end: message.end,
		totalSize: message.totalSize,
		mime: 'video/webm',
		kind: 'video',
		name: 'Remote clip',
		duration: 8,
		chunkSize: 8,
		ownerPeerId: 'peer-a',
		sourceKind: 'p2p',
		fallbackUrl: '',
		reason: message.reason,
	}))
	transport.send(new TextEncoder().encode(payload).buffer)
}

const createRegistryWithResource = (resourceId: string, attrs: Partial<ResourceAttrs> = {}): ProjectRegistry => {
	const entity: Entity = {
		id: resourceId,
		type: 'resource',
		attrs: {
			name: 'Remote clip',
			kind: 'video',
			url: '',
			mime: 'video/webm',
			duration: 8,
			size: 24,
			source: { kind: 'p2p', ownerPeerId: 'peer-a' },
			data: createMissingResourceData(8),
			status: 'missing',
			...attrs,
		},
		rels: {},
	}

	return {
		activeProjectId: null,
		projects: {},
		entitiesById: {
			[resourceId]: entity,
		},
	}
}

const createRegistryWithResources = (
	resources: Array<{ resourceId: string; attrs?: Partial<ResourceAttrs> }>,
): ProjectRegistry => ({
	activeProjectId: null,
	projects: {},
	entitiesById: Object.fromEntries(resources.map(({ resourceId, attrs }) => [
		resourceId,
		createRegistryWithResource(resourceId, attrs).entitiesById[resourceId],
	])),
})

describe('resource transfer manager', () => {
	const createObjectUrl = vi.fn<(blob: Blob) => string>()
	const revokeObjectUrl = vi.fn<(url: string) => void>()

	beforeEach(() => {
		createObjectUrl.mockReset()
		revokeObjectUrl.mockReset()
		let counter = 0
		vi.stubGlobal('URL', {
			...URL,
			createObjectURL: createObjectUrl.mockImplementation(() => `blob:test-${++counter}`),
			revokeObjectURL: revokeObjectUrl,
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('registers a local resource and exposes its object URL immediately', () => {
		const manager = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
		})

		const blob = new Blob(['abcdefgh'], { type: 'video/webm' })
		manager.registerLocalResource('res-local', blob, {
			objectUrl: 'blob:local-preview',
			kind: 'video',
			mime: 'video/webm',
			duration: 4,
			size: blob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Local clip',
		})

		expect(manager.resolveResourceUrl('res-local', '')).toBe('blob:local-preview')
		expect(manager.getTransfer('res-local')).toMatchObject({
			availability: 'local',
			status: 'ready',
			progress: 1,
		})

		manager.destroy()
	})

	it('requests remote chunks and assembles a preview URL over a raw p2p transport', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const server = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
		})
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
		})

		server.attachServerTransport('peer-b', serverTransport)
		client.attachClientTransport(clientTransport)

		const blob = new Blob(['abcdefghijklmnopqrstuvwx'], { type: 'video/webm' })
		server.registerLocalResource('res-remote', blob, {
			objectUrl: 'blob:server-local',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: blob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Remote clip',
		})

		client.syncRegistry(createRegistryWithResource('res-remote'))

		await waitFor(() => {
			expect(client.getTransfer('res-remote')).toMatchObject({
				availability: 'remote',
				status: 'ready',
				loadedBytes: blob.size,
				progress: 1,
				canPreview: true,
			})
		})

		const resolvedUrl = client.resolveResourceUrl('res-remote', '')
		expect(resolvedUrl).toMatch(/^blob:test-\d+$/)
		expect(createObjectUrl).toHaveBeenCalled()
		const sourceBytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
		const completedBlob = createObjectUrl.mock.calls.at(-1)?.[0]
		expect(completedBlob).toBeInstanceOf(Blob)
		const rebuiltBytes = Array.from(new Uint8Array(await (completedBlob as Blob).arrayBuffer()))
		expect(rebuiltBytes).toEqual(sourceBytes)

		client.destroy()
		server.destroy()
	})

	it('surfaces partial progress before completion when head and transfer delay are constrained', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const server = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
			chunkSendDelayMs: 250,
		})
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		server.attachServerTransport('peer-b', serverTransport)
		client.attachClientTransport(clientTransport)

		const blob = new Blob(['abcdefghijklmnopqrstuvwx'], { type: 'video/webm' })
		server.registerLocalResource('res-progressive', blob, {
			objectUrl: 'blob:server-local',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: blob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Progressive clip',
		})

		client.syncRegistry(createRegistryWithResource('res-progressive', { size: blob.size, duration: 8 }))
		client.requestPlayheadWindow('res-progressive', 4)
		await waitFor(() => {
			expect(client.getTransfer('res-progressive')?.requestEvents.some((event) =>
				event.reason === 'window' && event.ranges.some(([start]) => start > 0),
			)).toBe(true)
		})

		await waitFor(() => {
			const transfer = client.getTransfer('res-progressive')
			expect(transfer).toMatchObject({
				status: 'partial',
				canPreview: true,
			})
			expect((transfer?.progress ?? 0) > 0 && (transfer?.progress ?? 0) < 1).toBe(true)
		})

		await waitFor(() => {
			expect(client.getTransfer('res-progressive')).toMatchObject({
				status: 'ready',
				progress: 1,
			})
		})

		client.destroy()
		server.destroy()
	})

	it('serializes concurrent requests over a single raw transport without corrupting bytes', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const server = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
			chunkSendDelayMs: 1,
		})
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		server.attachServerTransport('peer-b', serverTransport)
		client.attachClientTransport(clientTransport)

		const blob = new Blob(['abcdefghijklmnopqrstuvwx'], { type: 'video/webm' })
		server.registerLocalResource('res-race', blob, {
			objectUrl: 'blob:server-race',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: blob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Race clip',
		})

		client.syncRegistry(createRegistryWithResource('res-race', { size: blob.size, duration: 8, name: 'Race clip' }))
		client.requestPlayheadWindow('res-race', 4)

		await waitFor(() => {
			expect(client.getTransfer('res-race')).toMatchObject({
				status: 'ready',
				loadedBytes: blob.size,
			})
		})

		const sourceBytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
		const completedBlob = createObjectUrl.mock.calls.at(-1)?.[0]
		expect(completedBlob).toBeInstanceOf(Blob)
		const rebuiltBytes = Array.from(new Uint8Array(await (completedBlob as Blob).arrayBuffer()))
		expect(rebuiltBytes).toEqual(sourceBytes)

		client.destroy()
		server.destroy()
	})

	it('resumes a partial transfer after client transport reconnect', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const server = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
			chunkSendDelayMs: 250,
		})
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		server.attachServerTransport('peer-b', serverTransport)
		client.attachClientTransport(clientTransport)

		const blob = new Blob(['abcdefghijklmnopqrstuvwx'], { type: 'video/webm' })
		server.registerLocalResource('res-reconnect', blob, {
			objectUrl: 'blob:server-reconnect',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: blob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Reconnect clip',
		})

		client.syncRegistry(createRegistryWithResource('res-reconnect', { size: blob.size, duration: 8, name: 'Reconnect clip' }))

		await waitFor(() => {
			expect(client.getTransfer('res-reconnect')).toMatchObject({
				status: 'partial',
				loadedBytes: 8,
			})
		})

		const [replacementServerTransport, replacementClientTransport] = createTransportPair()
		server.attachServerTransport('peer-b', replacementServerTransport)
		client.attachClientTransport(replacementClientTransport)

		await waitFor(() => {
			expect(client.getTransfer('res-reconnect')).toMatchObject({
				status: 'ready',
				loadedBytes: blob.size,
				progress: 1,
			})
		})

		client.destroy()
		server.destroy()
	})

	it('waits for owner registration before serving requests for a freshly imported p2p resource', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const server = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
		})
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		server.attachServerTransport('peer-b', serverTransport)
		client.attachClientTransport(clientTransport)

		const snapshot = createRegistryWithResource('res-client-owned', {
			size: 24,
			duration: 8,
			name: 'Client owned clip',
			source: { kind: 'p2p', ownerPeerId: 'peer-b' },
		})
		server.syncRegistry(snapshot)
		client.syncRegistry(snapshot)

		await waitFor(() => {
			expect(server.getTransfer('res-client-owned')).toMatchObject({
				status: 'requesting',
				loadedBytes: 0,
			})
		})

		const blob = new Blob(['abcdefghijklmnopqrstuvwx'], { type: 'video/webm' })
		client.registerLocalResource('res-client-owned', blob, {
			objectUrl: 'blob:client-owned',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: blob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-b',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Client owned clip',
		})

		await waitFor(() => {
			expect(server.getTransfer('res-client-owned')).toMatchObject({
				status: 'ready',
				loadedBytes: blob.size,
				progress: 1,
				lastError: null,
			})
		})

		server.destroy()
		client.destroy()
	})

	it('requests missing ranges again after an incomplete chunk-complete signal', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const requests = parseRequestMessages(serverTransport)
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		client.attachClientTransport(clientTransport)
		client.syncRegistry(createRegistryWithResource('res-gap', { size: 24, duration: 8, name: 'Gap clip' }))

		await waitFor(() => {
			expect(requests).toContainEqual(expect.objectContaining({
				resourceId: 'res-gap',
				ranges: [[0, 8]],
				reason: 'head',
			}))
		})

		sendChunk(serverTransport, {
			resourceId: 'res-gap',
			index: 0,
			start: 0,
			end: 8,
			totalSize: 24,
			reason: 'head',
		}, 'abcdefgh')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-gap',
			reason: 'head',
		}))

		await waitFor(() => {
			expect(requests).toContainEqual(expect.objectContaining({
				resourceId: 'res-gap',
				ranges: [[8, 16]],
				reason: 'sequential',
			}))
		})

		client.destroy()
	})

	it('prioritizes the latest playhead window before background sequential fetch', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const requests = parseRequestMessages(serverTransport)
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
			playheadWindowSeconds: 4,
		})

		client.attachClientTransport(clientTransport)
		client.syncRegistry(createRegistryWithResource('res-window-priority', {
			size: 40,
			duration: 10,
			name: 'Window priority clip',
		}))
		client.requestPlayheadWindow('res-window-priority', 6)

		await waitFor(() => {
			expect(requests.filter((message) => message.resourceId === 'res-window-priority')).toEqual([
				expect.objectContaining({
					resourceId: 'res-window-priority',
					ranges: [[0, 8]],
					reason: 'head',
				}),
			])
		})

		sendChunk(serverTransport, {
			resourceId: 'res-window-priority',
			index: 0,
			start: 0,
			end: 8,
			totalSize: 40,
			reason: 'head',
		}, 'abcdefgh')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-window-priority',
			reason: 'head',
		}))

		await waitFor(() => {
			const resourceRequests = requests.filter((message) => message.resourceId === 'res-window-priority')
			expect(resourceRequests[1]).toMatchObject({
				reason: 'window',
				ranges: [[16, 32]],
			})
		})

		sendChunk(serverTransport, {
			resourceId: 'res-window-priority',
			index: 2,
			start: 16,
			end: 24,
			totalSize: 40,
			reason: 'window',
		}, 'qrstuvwx')
		sendChunk(serverTransport, {
			resourceId: 'res-window-priority',
			index: 3,
			start: 24,
			end: 32,
			totalSize: 40,
			reason: 'window',
		}, 'yzabcdef')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-window-priority',
			reason: 'window',
		}))

		await waitFor(() => {
			const resourceRequests = requests.filter((message) => message.resourceId === 'res-window-priority')
			expect(resourceRequests.find((message) =>
				message.reason === 'sequential'
				&& JSON.stringify(message.ranges) === JSON.stringify([[8, 16]]),
			)).toBeTruthy()
			expect(resourceRequests.findIndex((message) => message.reason === 'window')).toBeLessThan(
				resourceRequests.findIndex((message) =>
					message.reason === 'sequential'
					&& JSON.stringify(message.ranges) === JSON.stringify([[8, 16]]),
				),
			)
		})

		client.destroy()
	})

	it('builds a sparse preview blob that preserves tail offsets after fallback', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const requests = parseRequestMessages(serverTransport)
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
			tailBytes: 8,
		})

		client.attachClientTransport(clientTransport)
		client.syncRegistry(createRegistryWithResource('res-tail-preview', {
			size: 32,
			duration: 8,
			name: 'Tail preview clip',
		}))

		sendChunk(serverTransport, {
			resourceId: 'res-tail-preview',
			index: 0,
			start: 0,
			end: 8,
			totalSize: 32,
			reason: 'head',
		}, 'ABCDEFGH')
		client.notePreviewError('res-tail-preview')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-tail-preview',
			reason: 'head',
		}))

		await waitFor(() => {
			expect(requests).toContainEqual(expect.objectContaining({
				resourceId: 'res-tail-preview',
				ranges: [[24, 32]],
				reason: 'tail',
			}))
		})

		sendChunk(serverTransport, {
			resourceId: 'res-tail-preview',
			index: 3,
			start: 24,
			end: 32,
			totalSize: 32,
			reason: 'tail',
		}, 'YZabcdef')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-tail-preview',
			reason: 'tail',
		}))

		await waitFor(() => {
			expect(client.getTransfer('res-tail-preview')).toMatchObject({
				status: 'partial',
				tailFallbackRequested: true,
				loadedRanges: [[0, 8], [24, 32]],
				canPreview: true,
			})
		})

		const sparseBlob = createObjectUrl.mock.calls.at(-1)?.[0]
		expect(sparseBlob).toBeInstanceOf(Blob)
		const sparseBytes = Array.from(new Uint8Array(await (sparseBlob as Blob).arrayBuffer()))
		expect(sparseBytes).toHaveLength(32)
		expect(sparseBytes.slice(0, 8)).toEqual(Array.from(new TextEncoder().encode('ABCDEFGH')))
		expect(sparseBytes.slice(8, 24)).toEqual(new Array(16).fill(0))
		expect(sparseBytes.slice(24, 32)).toEqual(Array.from(new TextEncoder().encode('YZabcdef')))

		client.destroy()
	})

	it('ignores invalid chunk metadata instead of counting corrupt ranges', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		client.attachClientTransport(clientTransport)
		client.syncRegistry(createRegistryWithResource('res-invalid', { size: 24, duration: 8, name: 'Invalid clip' }))

		sendChunk(serverTransport, {
			resourceId: 'res-invalid',
			index: 99,
			start: 792,
			end: 800,
			totalSize: 24,
			reason: 'head',
		}, 'xxxxxxxx')
		sendChunk(serverTransport, {
			resourceId: 'res-invalid',
			index: 0,
			start: 0,
			end: 8,
			totalSize: 24,
			reason: 'head',
		}, 'abcdefgh')

		await waitFor(() => {
			expect(client.getTransfer('res-invalid')).toMatchObject({
				loadedBytes: 8,
				loadedRanges: [[0, 8]],
				status: 'partial',
			})
		})
		expect(createObjectUrl).toHaveBeenCalledTimes(1)

		client.destroy()
	})

	it('keeps unknown-size partial transfers at zero progress until completion is known', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		client.attachClientTransport(clientTransport)
		client.syncRegistry(createRegistryWithResource('res-unknown-size', {
			size: undefined,
			duration: 8,
			name: 'Unknown size clip',
		}))

		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-meta',
			resourceId: 'res-unknown-size',
			index: 0,
			start: 0,
			end: 8,
			mime: 'video/webm',
			kind: 'video',
			name: 'Unknown size clip',
			duration: 8,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			reason: 'head',
		}))
		serverTransport.send(new TextEncoder().encode('abcdefgh').buffer)

		await waitFor(() => {
			expect(client.getTransfer('res-unknown-size')).toMatchObject({
				status: 'partial',
				loadedBytes: 8,
				totalBytes: 0,
				progress: 0,
			})
		})

		client.destroy()
	})

	it('retries a temporary resource error and resumes downloading', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const requests = parseRequestMessages(serverTransport)
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			headBytes: 8,
		})

		client.attachClientTransport(clientTransport)
		client.syncRegistry(createRegistryWithResource('res-retry', { size: 24, duration: 8, name: 'Retry clip' }))

		await waitFor(() => {
			expect(requests.length).toBeGreaterThanOrEqual(1)
		})

		serverTransport.send(JSON.stringify({
			type: 'resource-error',
			resourceId: 'res-retry',
			error: 'temporary failure',
		}))

		await waitFor(() => {
			expect(client.getTransfer('res-retry')).toMatchObject({
				status: 'requesting',
			})
			expect(client.getTransfer('res-retry')?.status).not.toBe('error')
		})

		await waitFor(() => {
			expect(requests.filter((message) => message.resourceId === 'res-retry')).toHaveLength(2)
		})

		sendChunk(serverTransport, {
			resourceId: 'res-retry',
			index: 0,
			start: 0,
			end: 8,
			totalSize: 24,
			reason: 'head',
		}, 'abcdefgh')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-retry',
			reason: 'head',
		}))

		await waitFor(() => {
			expect(requests.some((message) =>
				message.resourceId === 'res-retry'
				&& message.reason === 'sequential'
				&& JSON.stringify(message.ranges) === JSON.stringify([[8, 16]]),
			)).toBe(true)
		})

		sendChunk(serverTransport, {
			resourceId: 'res-retry',
			index: 1,
			start: 8,
			end: 16,
			totalSize: 24,
			reason: 'sequential',
		}, 'ijklmnop')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-retry',
			reason: 'sequential',
		}))

		await waitFor(() => {
			expect(requests.some((message) =>
				message.resourceId === 'res-retry'
				&& message.reason === 'sequential'
				&& JSON.stringify(message.ranges) === JSON.stringify([[16, 24]]),
			)).toBe(true)
		})

		sendChunk(serverTransport, {
			resourceId: 'res-retry',
			index: 2,
			start: 16,
			end: 24,
			totalSize: 24,
			reason: 'sequential',
		}, 'qrstuvwx')
		serverTransport.send(JSON.stringify({
			type: 'resource-chunk-complete',
			resourceId: 'res-retry',
			reason: 'sequential',
		}))

		await waitFor(() => {
			expect(client.getTransfer('res-retry')).toMatchObject({
				status: 'ready',
				loadedBytes: 24,
				progress: 1,
			})
		})

		client.destroy()
	})

	it('evicts older remote entries when the configured cache cap is exceeded', async () => {
		const [serverTransport, clientTransport] = createTransportPair()
		const server = createResourceTransferManager({
			getRole: () => 'server',
			getPeerId: () => 'peer-a',
			chunkSize: 8,
		})
		const client = createResourceTransferManager({
			getRole: () => 'client',
			getPeerId: () => 'peer-b',
			chunkSize: 8,
			maxCachedBytes: 24,
		})

		server.attachServerTransport('peer-b', serverTransport)
		client.attachClientTransport(clientTransport)

		const firstBlob = new Blob(['abcdefghijklmnopqrstuvwx'], { type: 'video/webm' })
		server.registerLocalResource('res-a', firstBlob, {
			objectUrl: 'blob:server-a',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: firstBlob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Clip A',
		})
		client.syncRegistry(createRegistryWithResource('res-a', { size: firstBlob.size, duration: 8, name: 'Clip A' }))

		await waitFor(() => {
			expect(client.getTransfer('res-a')).toMatchObject({
				status: 'ready',
				loadedBytes: firstBlob.size,
			})
		})

		const secondBlob = new Blob(['zyxwvutsrqponmlkjihgfedc'], { type: 'video/webm' })
		server.registerLocalResource('res-b', secondBlob, {
			objectUrl: 'blob:server-b',
			kind: 'video',
			mime: 'video/webm',
			duration: 8,
			size: secondBlob.size,
			chunkSize: 8,
			ownerPeerId: 'peer-a',
			sourceKind: 'p2p',
			fallbackUrl: '',
			name: 'Clip B',
		})
		client.syncRegistry(createRegistryWithResources([
			{ resourceId: 'res-a', attrs: { size: firstBlob.size, duration: 8, name: 'Clip A' } },
			{ resourceId: 'res-b', attrs: { size: secondBlob.size, duration: 8, name: 'Clip B' } },
		]))

		await waitFor(() => {
			expect(client.getTransfer('res-b')).toMatchObject({
				status: 'ready',
				loadedBytes: secondBlob.size,
			})
		})

		await waitFor(() => {
			expect(client.getTransfer('res-a')).toMatchObject({
				status: 'missing',
				loadedBytes: 0,
			})
		})

		client.destroy()
		server.destroy()
	})
})
