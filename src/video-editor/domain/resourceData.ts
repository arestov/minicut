import type {
	ResourceByteRange,
	ResourceChunkMeta,
	ResourceChunkStatus,
	ResourceDataState,
	ResourceDataStatus,
	ResourceDerived,
} from './types'

type ResourceDerivedInput = {
	kind: 'video' | 'audio' | 'image' | 'text'
	size?: number
	data?: ResourceDataState
}

export const DEFAULT_RESOURCE_CHUNK_SIZE = 1024 * 1024
export const RESOURCE_HEAD_PLAYABLE_BYTES = 2 * 1024 * 1024

const isFiniteNonNegative = (value: number | undefined): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0

const clampByte = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, Math.floor(value)))

export const createMissingResourceData = (
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
): ResourceDataState => ({
	status: 'missing',
	chunkSize,
	chunks: {},
	ranges: {
		loaded: [],
		requested: [],
	},
	loadedBytes: 0,
})

export const createChunkMeta = ({
	index,
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
	totalSize,
	status = 'missing',
}: {
	index: number
	chunkSize?: number
	totalSize?: number
	status?: ResourceChunkStatus
}): ResourceChunkMeta => {
	const start = Math.max(0, Math.floor(index) * chunkSize)
	const end = isFiniteNonNegative(totalSize)
		? clampByte(start + chunkSize, start, totalSize)
		: start + chunkSize

	return {
		index: Math.floor(index),
		start,
		end,
		size: Math.max(0, end - start),
		status,
	}
}


const createReadyChunks = (
	size: number,
	chunkSize: number,
): Record<number, ResourceChunkMeta> => {
	const chunks: Record<number, ResourceChunkMeta> = {}
	const chunkCount = Math.ceil(size / chunkSize)
	for (let index = 0; index < chunkCount; index += 1) {
		chunks[index] = createChunkMeta({ index, chunkSize, totalSize: size, status: 'ready' })
	}
	return chunks
}

export const createReadyResourceData = ({
	size,
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
}: {
	size?: number
	chunkSize?: number
} = {}): ResourceDataState => {
	if (isFiniteNonNegative(size) && size > 0) {
		return {
			status: 'ready',
			chunkSize,
			chunks: createReadyChunks(size, chunkSize),
			ranges: {
				loaded: [[0, size]],
				requested: [],
			},
			loadedBytes: size,
		}
	}

	return {
		...createMissingResourceData(chunkSize),
		status: 'ready',
	}
}

export const mergeByteRanges = (ranges: ResourceByteRange[]): ResourceByteRange[] => {
	const sorted = ranges
		.map(([start, end]) => [Math.floor(start), Math.floor(end)] as ResourceByteRange)
		.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])

	const merged: ResourceByteRange[] = []
	for (const range of sorted) {
		const previous = merged[merged.length - 1]
		if (!previous || range[0] > previous[1]) {
			merged.push([...range])
			continue
		}

		previous[1] = Math.max(previous[1], range[1])
	}

	return merged
}

const countReadyBytes = (chunks: Record<number, ResourceChunkMeta>): number =>
	Object.values(chunks).reduce(
		(total, chunk) => total + (chunk.status === 'ready' ? Math.max(0, chunk.size) : 0),
		0,
	)

const resolveStatus = (
	loadedBytes: number,
	totalSize?: number,
): ResourceDataStatus => {
	if (loadedBytes <= 0) {
		return 'missing'
	}

	if (isFiniteNonNegative(totalSize) && totalSize > 0 && loadedBytes >= totalSize) {
		return 'ready'
	}

	return 'partial'
}

export const markResourceChunkReady = (
	data: ResourceDataState,
	chunk: ResourceChunkMeta,
	totalSize?: number,
): ResourceDataState => {
	const readyChunk = {
		...chunk,
		status: 'ready' as const,
		size: Math.max(0, chunk.end - chunk.start),
	}
	const chunks = {
		...data.chunks,
		[readyChunk.index]: readyChunk,
	}
	const loadedRanges = mergeByteRanges([
		...data.ranges.loaded,
		[readyChunk.start, readyChunk.end],
	])
	const loadedBytes = countReadyBytes(chunks)

	return {
		...data,
		status: resolveStatus(loadedBytes, totalSize),
		chunks,
		ranges: {
			...data.ranges,
			loaded: loadedRanges,
		},
		loadedBytes,
	}
}

const hasHeadRange = (
	ranges: ResourceByteRange[],
	requiredBytes: number,
): boolean => ranges.some(([start, end]) => start <= 0 && end >= requiredBytes)

export const getResourceDerived = (attrs: ResourceDerivedInput): ResourceDerived => {
	const data = attrs.data ?? createMissingResourceData()
	const loadedBytes = Math.max(0, Number(data.loadedBytes) || 0)
	const size = isFiniteNonNegative(attrs.size) ? attrs.size : undefined
	const progress = data.status === 'ready'
		? 1
		: size && size > 0
			? Math.min(1, loadedBytes / size)
			: loadedBytes > 0 ? 0.01 : 0
	const requiredHeadBytes = size && size > 0
		? Math.min(size, RESOURCE_HEAD_PLAYABLE_BYTES)
		: RESOURCE_HEAD_PLAYABLE_BYTES
	const canUsePartialHead = attrs.kind !== 'image'
		&& data.status === 'partial'
		&& hasHeadRange(data.ranges.loaded, requiredHeadBytes)

	return {
		progress,
		isPlayable: data.status === 'ready' || canUsePartialHead,
		loadedBytes,
		loadedRanges: data.ranges.loaded,
		requestedRanges: data.ranges.requested,
	}
}