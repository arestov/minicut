/**
 * Tests for Track → Clip rel wiring via self-rel pattern.
 *
 * These tests verify that when Track creates Clip models (addClip, addTextClip, splitClipAt),
 * the Clip's `track` rel is correctly populated with the parent Track model.
 *
 * Root cause being fixed: without `rels: { track: self }` in creation payload
 * and `rels: { track: {} }` in CLIP_CREATION_SHAPE, `clip.track` is always null,
 * which breaks the split-saga chain (`removeSelf` → `<< track` → `removeClipBySourceId`).
 */

import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

const PROJECT_ID = 'test-track-rel'
const TRACK_VIDEO_ID = `${PROJECT_ID}:track:video`

const setupProjectAndTrack = async () => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', {
			sourceProjectId: PROJECT_ID,
			title: 'Track-Clip Rel Test Project',
		})
	})

	const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) throw new Error('No active project after createProject')

	const tracks = await ctx.queryRel(project, 'tracks')
	const videoTrack = tracks.find((t) => ctx.getAttr(t, 'sourceTrackId') === TRACK_VIDEO_ID)
	if (!videoTrack) throw new Error(`Video track not found: ${TRACK_VIDEO_ID}`)

	return { ctx, project, videoTrack }
}

describe('Track self-rel: addClip', () => {
	it('addClip sets track rel on the newly created clip', async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack()

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('addClip', {
				sourceClipId: 'clip:rel-test-1',
				name: 'Test Clip',
				mediaKind: 'video',
				start: 0,
				in: 0,
				duration: 2,
			})
		})

		const clips = await ctx.queryRel(videoTrack, 'clips')
		expect(clips).toHaveLength(1)

		const clip = clips[0]
		const trackRel = await ctx.queryRel(clip, 'track')
		expect(trackRel).toHaveLength(1)
		expect(trackRel[0]).toBe(videoTrack)
	})

	it('addClip with multiple clips — each clip has track rel pointing to the same track', async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack()

		for (let i = 0; i < 3; i++) {
			await ctx.lockToRead(async () => {
				await videoTrack.dispatch('addClip', {
					sourceClipId: `clip:multi-${i}`,
					name: `Clip ${i}`,
					mediaKind: 'video',
					start: i,
					in: 0,
					duration: 1,
				})
			})
		}

		const clips = await ctx.queryRel(videoTrack, 'clips')
		expect(clips).toHaveLength(3)

		for (const clip of clips) {
			const trackRel = await ctx.queryRel(clip, 'track')
			expect(trackRel).toHaveLength(1)
			expect(trackRel[0]).toBe(videoTrack)
		}
	})
})

describe('Track self-rel: addTextClip', () => {
	it('addTextClip sets track rel on the created text clip', async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack()

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('addTextClip', {
				sourceClipId: 'clip:text-rel-test-1',
				name: 'Text Clip',
				mediaKind: 'text',
				start: 0,
				in: 0,
				duration: 3,
				text: {
					sourceTextId: 'text:rel-test-1',
					content: 'Hello World',
					fontFamily: 'sans-serif',
					fontSize: 48,
					fontWeight: 400,
					color: '#ffffff',
				},
			})
		})

		const clips = await ctx.queryRel(videoTrack, 'clips')
		expect(clips).toHaveLength(1)

		const clip = clips[0]
		expect(ctx.getAttr(clip, 'mediaKind')).toBe('text')

		const trackRel = await ctx.queryRel(clip, 'track')
		expect(trackRel).toHaveLength(1)
		expect(trackRel[0]).toBe(videoTrack)
	})
})

describe('Track self-rel: splitClipAt', () => {
	it('splitClipAt sets track rel on the right-split clip', async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack()

		// First add a clip
		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('addClip', {
				sourceClipId: 'clip:split-base',
				name: 'Base Clip',
				mediaKind: 'video',
				start: 0,
				in: 0,
				duration: 2,
			})
		})

		// Now split it: create the right clip directly via track's splitClipAt
		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('splitClipAt', {
				sourceClipId: 'clip:split-right-1',
				name: 'Base Clip',
				mediaKind: 'video',
				splitTime: 1,
				sourceClip: { start: 0, in: 0, duration: 2 },
				start: 1,
				in: 1,
				duration: 1,
				fadeIn: 0,
				fadeOut: 0,
				audio: { gain: 1, pan: 0 },
				opacity: { value: 1 },
				transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
			})
		})

		const clips = await ctx.queryRel(videoTrack, 'clips')
		const rightClip = clips.find((c) => ctx.getAttr(c, 'sourceClipId') === 'clip:split-right-1')
		expect(rightClip).toBeTruthy()

		const trackRel = await ctx.queryRel(rightClip!, 'track')
		expect(trackRel).toHaveLength(1)
		expect(trackRel[0]).toBe(videoTrack)
	})
})
