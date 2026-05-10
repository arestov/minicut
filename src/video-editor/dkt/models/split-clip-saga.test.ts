import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

const setupWithClip = async (duration: number) => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', {
			title: 'Split Saga Test',
		})
	})

	const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) throw new Error('No active project')

	const tracks = await ctx.queryRel(project, 'tracks')
	const videoTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'video')
	if (!videoTrack) throw new Error('Video track not found')

	await ctx.lockToRead(async () => {
		await videoTrack.dispatch('addClip', {
			name: 'Test Clip',
			mediaKind: 'video',
			start: 0,
			in: 0,
			duration,
		})
	})

	const clip = (await ctx.queryRel(videoTrack, 'clips'))[0]
	if (!clip) throw new Error('Clip not found')

	return { ctx, videoTrack, clip }
}

describe('Clip.splitSelfAt saga: full 3-step chain', () => {
	it('step 1: reduces left clip duration', async () => {
		const { ctx, clip } = await setupWithClip(2)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 1 })
		})

		expect(ctx.getAttr(clip, 'duration')).toBe(1)
	})

	it('step 2: creates right-split clip on the track', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip(2)
		const originalClipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 1 })
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		expect(clipsAfter.length).toBeGreaterThanOrEqual(2)

		const rightClip = clipsAfter.find((c) => String(c._node_id) !== originalClipId)
		expect(rightClip).toBeTruthy()
		expect(ctx.getAttr(rightClip!, 'start')).toBe(1)
		expect(ctx.getAttr(rightClip!, 'duration')).toBe(1)
	})

	it('step 3: clears splitOriginalDuration scratch attr after split', async () => {
		const { ctx, clip } = await setupWithClip(4)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 2 })
		})

		expect(ctx.getAttr(clip, 'splitOriginalDuration')).toBeNull()
	})

	it('right-split clip has track rel set (regression guard for the null-track bug)', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip(2)
		const originalClipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 1 })
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		const rightClip = clipsAfter.find((c) => String(c._node_id) !== originalClipId)
		expect(rightClip).toBeTruthy()

		const trackRel = await ctx.queryRel(rightClip!, 'track')
		expect(trackRel).toHaveLength(1)
		expect(trackRel[0]).toBe(videoTrack)
	})

	it('split outside clip bounds returns noop and clip is untouched', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip(2)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 3 })
		})

		expect(ctx.getAttr(clip, 'duration')).toBe(2)
		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		expect(clipsAfter).toHaveLength(1)
	})
})

describe('SessionRoot.splitSelectedClip E2E', () => {
	it('splitting selected clip creates two clips with correct durations', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip(4)
		const selectedClipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('selectEntity', selectedClipId)
			await ctx.sessionRoot.dispatch('setCursor', 2)
		})

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('splitSelectedClip')
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		expect(clipsAfter.length).toBeGreaterThanOrEqual(2)

		const leftClip = clipsAfter.find((c) => String(c._node_id) === selectedClipId)
		expect(leftClip).toBeTruthy()
		expect(ctx.getAttr(leftClip!, 'duration')).toBe(2)
		expect(ctx.getAttr(leftClip!, 'start')).toBe(0)

		const rightClip = clipsAfter.find((c) => String(c._node_id) !== selectedClipId)
		expect(rightClip).toBeTruthy()
		expect(ctx.getAttr(rightClip!, 'duration')).toBe(2)
		expect(ctx.getAttr(rightClip!, 'start')).toBe(2)
	})
})

describe('SessionRoot selected clip edit actions', () => {
	it('nudgeSelectedClip moves the selected clip through the session action', async () => {
		const { ctx, clip } = await setupWithClip(4)
		const selectedClipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('selectEntity', selectedClipId)
			await ctx.sessionRoot.dispatch('nudgeSelectedClip', { delta: 0.5 })
		})

		expect(ctx.getAttr(clip, 'start')).toBe(0.5)
	})

	it('deleteSelectedClip removes the selected clip and clears selection', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip(4)
		const selectedClipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('selectEntity', selectedClipId)
		})
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('deleteSelectedClip')
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		const clipIds = clipsAfter.map((entry) => String(entry._node_id))
		expect(clipIds).not.toContain(selectedClipId)
		expect(ctx.getAttr(ctx.sessionRoot, 'selectedEntityId')).toBeNull()
	})

	it('removeSelf removes the clip from its parent track', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip(4)
		const clipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await clip.dispatch('removeSelf')
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		const clipIds = clipsAfter.map((entry) => String(entry._node_id))
		expect(clipIds).not.toContain(clipId)
	})
})
