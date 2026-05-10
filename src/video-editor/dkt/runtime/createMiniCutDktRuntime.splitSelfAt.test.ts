import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

const setupWithClip = async () => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', { title: 'Split relation test project' })
	})

	const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) throw new Error('No active project')
	const tracks = await ctx.queryRel(project, 'tracks')
	const videoTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'video')
	if (!videoTrack) throw new Error('Video track not found')

	await ctx.lockToRead(async () => {
		await videoTrack.dispatch('addClip', {
			name: 'fixture-video.webm',
			mediaKind: 'video',
			start: 0,
			in: 0,
			duration: 1,
		})
	})

	const clip = (await ctx.queryRel(videoTrack, 'clips'))[0]
	if (!clip) throw new Error('Clip not found')

	return { ctx, project, videoTrack, clip }
}

describe('splitSelfAt data flow', () => {
	it('splitSelectedClip splits left clip and auto-creates right clip via saga chain', async () => {
		const { ctx, videoTrack, clip } = await setupWithClip()
		const clipId = String(clip._node_id)

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('selectEntity', clipId)
			await ctx.sessionRoot.dispatch('setCursor', 0.5)
		})

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('splitSelectedClip')
		})

		const clips = await ctx.queryRel(videoTrack, 'clips')
		expect(clips).toHaveLength(2)

		const left = clips.find((entry) => String(entry._node_id) === clipId)
		expect(left, 'left clip must exist').toBeTruthy()
		expect(ctx.getAttr(left!, 'duration')).toBe(0.5)
		expect(ctx.getAttr(left!, 'start')).toBe(0)

		const right = clips.find((entry) => String(entry._node_id) !== clipId)
		expect(right, 'right clip must be auto-created').toBeTruthy()
		expect(ctx.getAttr(right!, 'start')).toBe(0.5)
		expect(ctx.getAttr(right!, 'duration')).toBe(0.5)
	})

	it('manual splitClipAt on track creates right clip with correct start/duration', async () => {
		const { ctx, videoTrack } = await setupWithClip()
		const beforeClips = await ctx.queryRel(videoTrack, 'clips')

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('splitClipAt', {
				name: 'fixture-video.webm',
				mediaKind: 'video',
				splitTime: 0.5,
				sourceClip: { start: 0, in: 0, duration: 1 },
			})
		})

		const clips = await ctx.queryRel(videoTrack, 'clips')
		const rightClip = clips.find((clip) => !beforeClips.some((before) => before._node_id === clip._node_id))
		expect(rightClip).toBeTruthy()
		expect(ctx.getAttr(rightClip!, 'start')).toBe(0.5)
		expect(ctx.getAttr(rightClip!, 'duration')).toBe(0.5)
	})
})
