import {
	alignRangeToChunkSize,
	buildRangeKey,
	getContiguousRangeEnd,
	getHeadPreviewRange,
	getPlayheadWindowRange,
	getTailFallbackRange,
	subtractByteRanges,
} from './resourceTransferScheduler'

describe('resource transfer scheduler', () => {
	it('aligns and clamps ranges to chunk boundaries', () => {
		expect(alignRangeToChunkSize([3, 17], 8, 20)).toEqual([0, 20])
		expect(alignRangeToChunkSize([9, 15], 8, 20)).toEqual([8, 16])
		expect(alignRangeToChunkSize([4, 4], 8, 20)).toBeNull()
	})

	it('builds head, tail, and playhead ranges', () => {
		expect(getHeadPreviewRange(24, 8)).toEqual([0, 24])
		expect(getTailFallbackRange(40, 8, 10)).toEqual([24, 40])
		expect(getPlayheadWindowRange({ totalSize: 80, duration: 10, time: 5, chunkSize: 8, windowSeconds: 2 })).toEqual([32, 48])
	})

	it('subtracts loaded ranges and tracks contiguous head coverage', () => {
		expect(subtractByteRanges([[0, 32]], [[0, 8], [16, 24]])).toEqual([[8, 16], [24, 32]])
		expect(getContiguousRangeEnd([[16, 24], [0, 8], [8, 16]])).toBe(24)
		expect(buildRangeKey([24, 40])).toBe('24:40')
	})
})
