import {
	DEFAULT_RESOURCE_CHUNK_SIZE,
	RESOURCE_HEAD_PLAYABLE_BYTES,
	createChunkMeta,
	createMissingResourceData,
	createReadyResourceData,
	getResourceDerived,
	markResourceChunkReady,
} from './resourceData'
import type { ResourceAttrs } from './types'

const createResourceAttrs = (partial: Partial<ResourceAttrs> = {}): ResourceAttrs => ({
	name: 'Camera take',
	kind: 'video',
	url: '',
	mime: 'video/webm',
	duration: 10,
	size: 4 * DEFAULT_RESOURCE_CHUNK_SIZE,
	source: { kind: 'p2p', ownerPeerId: 'peer-a' },
	data: createMissingResourceData(),
	status: 'missing',
	...partial,
})

describe('resource data model', () => {
	it('creates missing data with empty chunk and range indexes', () => {
		const data = createMissingResourceData()
		const derived = getResourceDerived(createResourceAttrs({ data, status: data.status }))

		expect(data).toMatchObject({
			status: 'missing',
			chunks: {},
			ranges: { loaded: [], requested: [] },
			loadedBytes: 0,
		})
		expect(derived.progress).toBe(0)
		expect(derived.isPlayable).toBe(false)
	})

	it('creates ready data with full progress when size is known', () => {
		const size = 3 * DEFAULT_RESOURCE_CHUNK_SIZE
		const data = createReadyResourceData({ size })
		const derived = getResourceDerived(createResourceAttrs({ data, status: data.status, size }))

		expect(data.status).toBe('ready')
		expect(data.loadedBytes).toBe(size)
		expect(data.ranges.loaded).toEqual([[0, size]])
		expect(Object.values(data.chunks)).toHaveLength(3)
		expect(derived.progress).toBe(1)
		expect(derived.isPlayable).toBe(true)
	})

	it('marks chunks ready, merges loaded ranges, and avoids duplicate byte counts', () => {
		let data = createMissingResourceData()
		const totalSize = 4 * DEFAULT_RESOURCE_CHUNK_SIZE
		const chunk1 = createChunkMeta({ index: 1, totalSize })
		const chunk0 = createChunkMeta({ index: 0, totalSize })

		data = markResourceChunkReady(data, chunk1, totalSize)
		expect(data.status).toBe('partial')
		expect(data.ranges.loaded).toEqual([[DEFAULT_RESOURCE_CHUNK_SIZE, 2 * DEFAULT_RESOURCE_CHUNK_SIZE]])

		data = markResourceChunkReady(data, chunk0, totalSize)
		expect(data.ranges.loaded).toEqual([[0, 2 * DEFAULT_RESOURCE_CHUNK_SIZE]])
		expect(data.loadedBytes).toBe(2 * DEFAULT_RESOURCE_CHUNK_SIZE)

		data = markResourceChunkReady(data, chunk0, totalSize)
		expect(data.loadedBytes).toBe(2 * DEFAULT_RESOURCE_CHUNK_SIZE)
	})

	it('treats head-loaded video and audio resources as playable by heuristic', () => {
		let data = createMissingResourceData()
		const totalSize = 6 * DEFAULT_RESOURCE_CHUNK_SIZE
		for (let index = 0; index < RESOURCE_HEAD_PLAYABLE_BYTES / DEFAULT_RESOURCE_CHUNK_SIZE; index += 1) {
			data = markResourceChunkReady(data, createChunkMeta({ index, totalSize }), totalSize)
		}

		expect(getResourceDerived(createResourceAttrs({ data, status: data.status, size: totalSize })).isPlayable).toBe(true)
		expect(getResourceDerived(createResourceAttrs({ kind: 'audio', data, status: data.status, size: totalSize })).isPlayable).toBe(true)
		expect(getResourceDerived(createResourceAttrs({ kind: 'image', data, status: data.status, size: totalSize })).isPlayable).toBe(false)
	})
})
