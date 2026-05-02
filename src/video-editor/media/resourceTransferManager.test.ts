import { waitFor } from '@testing-library/react'
import type { Entity, ProjectRegistry, ResourceAttrs } from '../domain/types'
import { createMissingResourceData } from '../domain/resourceData'
import { createResourceTransferManager } from './resourceTransferManager'
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
				loadedBytes: 24,
				progress: 1,
				canPreview: true,
			})
		})

		const resolvedUrl = client.resolveResourceUrl('res-remote', '')
		expect(resolvedUrl).toMatch(/^blob:test-\d+$/)
		expect(createObjectUrl).toHaveBeenCalled()

		client.destroy()
		server.destroy()
	})
})
