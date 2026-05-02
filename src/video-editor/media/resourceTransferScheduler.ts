import { DEFAULT_RESOURCE_CHUNK_SIZE, RESOURCE_HEAD_PLAYABLE_BYTES, mergeByteRanges } from '../domain/resourceData'
import type { ResourceByteRange } from '../domain/types'

export const DEFAULT_RESOURCE_TAIL_FALLBACK_BYTES = 256 * 1024
export const DEFAULT_PLAYHEAD_WINDOW_SECONDS = 4

const normalizeByte = (value: number): number => Math.max(0, Math.floor(value))

export const clampRangeToSize = (
	range: ResourceByteRange,
	totalSize?: number,
): ResourceByteRange | null => {
	const start = normalizeByte(range[0])
	const end = normalizeByte(range[1])
	if (end <= start) {
		return null
	}

	if (typeof totalSize !== 'number' || !Number.isFinite(totalSize) || totalSize <= 0) {
		return [start, end]
	}

	const clampedStart = Math.min(start, totalSize)
	const clampedEnd = Math.min(Math.max(clampedStart, end), totalSize)
	return clampedEnd > clampedStart ? [clampedStart, clampedEnd] : null
}

export const alignRangeToChunkSize = (
	range: ResourceByteRange,
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
	totalSize?: number,
): ResourceByteRange | null => {
	const normalized = clampRangeToSize(range, totalSize)
	if (!normalized) {
		return null
	}

	const start = Math.floor(normalized[0] / chunkSize) * chunkSize
	const end = Math.ceil(normalized[1] / chunkSize) * chunkSize
	return clampRangeToSize([start, end], totalSize)
}

export const getHeadPreviewRange = (
	totalSize?: number,
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
	headBytes = RESOURCE_HEAD_PLAYABLE_BYTES,
): ResourceByteRange | null => {
	if (typeof totalSize === 'number' && totalSize <= 0) {
		return null
	}

	const targetEnd = typeof totalSize === 'number' && Number.isFinite(totalSize)
		? Math.min(totalSize, headBytes)
		: headBytes
	return alignRangeToChunkSize([0, targetEnd], chunkSize, totalSize)
}

export const getTailFallbackRange = (
	totalSize?: number,
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
	tailBytes = DEFAULT_RESOURCE_TAIL_FALLBACK_BYTES,
): ResourceByteRange | null => {
	if (typeof totalSize !== 'number' || !Number.isFinite(totalSize) || totalSize <= 0) {
		return null
	}

	return alignRangeToChunkSize([Math.max(0, totalSize - tailBytes), totalSize], chunkSize, totalSize)
}

export const getPlayheadWindowRange = ({
	totalSize,
	duration,
	time,
	chunkSize = DEFAULT_RESOURCE_CHUNK_SIZE,
	windowSeconds = DEFAULT_PLAYHEAD_WINDOW_SECONDS,
}: {
	totalSize?: number
	duration?: number
	time: number
	chunkSize?: number
	windowSeconds?: number
}): ResourceByteRange | null => {
	if (
		typeof totalSize !== 'number'
		|| !Number.isFinite(totalSize)
		|| totalSize <= 0
		|| typeof duration !== 'number'
		|| !Number.isFinite(duration)
		|| duration <= 0
	) {
		return null
	}

	const bytesPerSecond = totalSize / duration
	const halfWindowBytes = Math.max(chunkSize, bytesPerSecond * windowSeconds * 0.5)
	const center = Math.max(0, Math.min(totalSize, Math.floor((time / duration) * totalSize)))
	return alignRangeToChunkSize([center - halfWindowBytes, center + halfWindowBytes], chunkSize, totalSize)
}

export const getContiguousRangeEnd = (ranges: ResourceByteRange[]): number => {
	const merged = mergeByteRanges(ranges)
	const head = merged.find(([start]) => start === 0)
	return head ? head[1] : 0
}

export const subtractByteRanges = (
	ranges: ResourceByteRange[],
	coveredRanges: ResourceByteRange[],
): ResourceByteRange[] => {
	const pending = mergeByteRanges(ranges)
	const covered = mergeByteRanges(coveredRanges)
	if (covered.length === 0) {
		return pending
	}

	const next: ResourceByteRange[] = []
	for (const [start, end] of pending) {
		let cursor = start
		for (const [coveredStart, coveredEnd] of covered) {
			if (coveredEnd <= cursor) {
				continue
			}
			if (coveredStart >= end) {
				break
			}
			if (coveredStart > cursor) {
				next.push([cursor, Math.min(coveredStart, end)])
			}
			cursor = Math.max(cursor, coveredEnd)
			if (cursor >= end) {
				break
			}
		}

		if (cursor < end) {
			next.push([cursor, end])
		}
	}

	return mergeByteRanges(next)
}

export const buildRangeKey = (range: ResourceByteRange | null): string =>
	range ? `${range[0]}:${range[1]}` : ''
