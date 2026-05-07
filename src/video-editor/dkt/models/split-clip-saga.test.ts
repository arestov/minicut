/**
 * Tests for the Clip splitSelfAt saga (3-step DKT action chain).
 *
 * Step 1: Clip reduces its own duration to the split point
 * Step 2: Clip delegates to Track via `<< track` to create the right-split clip
 * Step 3: Clip clears the `splitOriginalDuration` scratch attr
 *
 * Root cause that was broken: step 2 was silently skipped because `clip.track`
 * rel was null — no Track target to dispatch splitClipAt to.
 *
 * After the fix (rels: { track: self } in creation payload + rels: { track: {} }
 * in CLIP_CREATION_SHAPE), the full 3-step chain works.
 */

import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

const PROJECT_ID = 'test-split-saga'
const TRACK_VIDEO_ID = `${PROJECT_ID}:track:video`

const setupWithClip = async (sourceClipId: string, duration: number) => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', {
			sourceProjectId: PROJECT_ID,
			title: 'Split Saga Test',
		})
	})

	const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) throw new Error('No active project')

	const tracks = await ctx.queryRel(project, 'tracks')
	const videoTrack = tracks.find((t) => ctx.getAttr(t, 'sourceTrackId') === TRACK_VIDEO_ID)
	if (!videoTrack) throw new Error('Video track not found')

	await ctx.lockToRead(async () => {
		await videoTrack.dispatch('addClip', {
			sourceClipId,
			name: 'Test Clip',
			mediaKind: 'video',
			start: 0,
			in: 0,
			duration,
		})
	})

	const clips = await ctx.queryRel(videoTrack, 'clips')
	const clip = clips.find((c) => ctx.getAttr(c, 'sourceClipId') === sourceClipId)
	if (!clip) throw new Error(`Clip not found: ${sourceClipId}`)

	return { ctx, videoTrack, clip }
}

describe('Clip.splitSelfAt saga: full 3-step chain', () => {
	it('step 1: reduces left clip duration', async () => {
		const { ctx, clip } = await setupWithClip('clip:saga-1', 2)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 1 })
		})

		const leftDuration = ctx.getAttr(clip, 'duration')
		expect(leftDuration).toBe(1)
	})

	it('step 2: creates right-split clip on the track', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip('clip:saga-2', 2)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 1 })
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		expect(clipsAfter.length).toBeGreaterThanOrEqual(2)

		const rightClip = clipsAfter.find((c) => {
			const start = ctx.getAttr(c, 'start')
			return typeof start === 'number' && start === 1
		})

		expect(rightClip).toBeTruthy()
		const rightDuration = ctx.getAttr(rightClip!, 'duration')
		expect(rightDuration).toBe(1)
	})

	it('step 3: clears splitOriginalDuration scratch attr after split', async () => {
		const { ctx, clip } = await setupWithClip('clip:saga-3', 4)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 2 })
		})

		const scratch = ctx.getAttr(clip, 'splitOriginalDuration')
		expect(scratch).toBeNull()
	})

	it('right-split clip has track rel set (regression guard for the null-track bug)', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip('clip:saga-4', 2)

		await ctx.lockToRead(async () => {
			await clip.dispatch('splitSelfAt', { time: 1 })
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		const rightClip = clipsAfter.find((c) => {
			const start = ctx.getAttr(c, 'start')
			return typeof start === 'number' && start === 1
		})
		expect(rightClip).toBeTruthy()

		const trackRel = await ctx.queryRel(rightClip!, 'track')
		expect(trackRel).toHaveLength(1)
		expect(trackRel[0]).toBe(videoTrack)
	})

	it('split outside clip bounds returns noop — clip is untouched', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip('clip:saga-noop', 2)

		await ctx.lockToRead(async () => {
			// time=3 is beyond duration=2, so splitSelfAt should return $noop at step 1
			await clip.dispatch('splitSelfAt', { time: 3 })
		})

		expect(ctx.getAttr(clip, 'duration')).toBe(2)
		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		expect(clipsAfter).toHaveLength(1)
	})
})

describe('SessionRoot.splitSelectedClip E2E', () => {
	it('splitting selected clip creates two clips with correct durations', async () => {
		const ctx = await bootDktModels()

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('createProject', {
				sourceProjectId: 'test-e2e-split',
				title: 'E2E Split Test',
			})
		})

		const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
		if (!project) throw new Error('No active project')

		const tracks = await ctx.queryRel(project, 'tracks')
		const videoTrack = tracks.find((t) => ctx.getAttr(t, 'sourceTrackId') === 'test-e2e-split:track:video')
		if (!videoTrack) throw new Error('Video track not found')

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('addClip', {
				sourceClipId: 'clip:e2e-split-target',
				name: 'E2E Clip',
				mediaKind: 'video',
				start: 0,
				in: 0,
				duration: 4,
			})
		})

		// Select clip and set cursor to split point
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('selectEntity', 'clip:e2e-split-target')
			await ctx.sessionRoot.dispatch('setCursor', 2)
		})

		// Dispatch splitSelectedClip
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('splitSelectedClip')
		})

		const clipsAfter = await ctx.queryRel(videoTrack, 'clips')
		expect(clipsAfter.length).toBeGreaterThanOrEqual(2)

		const leftClip = clipsAfter.find((c) => ctx.getAttr(c, 'sourceClipId') === 'clip:e2e-split-target')
		expect(leftClip).toBeTruthy()
		expect(ctx.getAttr(leftClip!, 'duration')).toBe(2)
		expect(ctx.getAttr(leftClip!, 'start')).toBe(0)

		const rightClip = clipsAfter.find((c) => {
			const start = ctx.getAttr(c, 'start')
			return typeof start === 'number' && start === 2
		})
		expect(rightClip).toBeTruthy()
		expect(ctx.getAttr(rightClip!, 'duration')).toBe(2)
		expect(ctx.getAttr(rightClip!, 'start')).toBe(2)
	})
})
