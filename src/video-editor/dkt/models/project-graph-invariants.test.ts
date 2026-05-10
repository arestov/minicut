import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'
import {
	expectProjectGraphInvariants,
	findTrackByKind,
} from '../test/projectGraphAssertions'

const setupProject = async () => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', {
			title: 'Graph Invariants Test',
		})
	})

	const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) throw new Error('No active project')

	const videoTrack = await findTrackByKind(ctx, 'video')
	const audioTrack = await findTrackByKind(ctx, 'audio')

	return { ctx, project, videoTrack, audioTrack }
}

describe('project graph invariants', () => {
	it('stay intact after import, append, embedded audio, and split actions', async () => {
		const { ctx, project, videoTrack, audioTrack } = await setupProject()

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				name: 'Graph Video',
				kind: 'video',
				url: 'http://test/graph-video.webm',
				mime: 'video/webm',
				duration: 3,
				size: 1024,
				source: { kind: 'local', ownerPeerId: 'test-peer' },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 1024]], requested: [] },
					loadedBytes: 1024,
				},
			})
		})

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				name: 'Graph Audio',
				kind: 'audio',
				url: 'http://test/graph-audio.wav',
				mime: 'audio/wav',
				duration: 2,
				size: 512,
				source: { kind: 'local', ownerPeerId: 'test-peer' },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 512]], requested: [] },
					loadedBytes: 512,
				},
			})
		})

		const resources = await ctx.queryRel(project, 'resources')
		const videoResource = resources.find((resource) => ctx.getAttr(resource, 'name') === 'Graph Video')
		const audioResource = resources.find((resource) => ctx.getAttr(resource, 'name') === 'Graph Audio')
		if (!videoResource?._node_id || !audioResource?._node_id) {
			throw new Error('Expected imported graph resources')
		}

		await ctx.lockToRead(async () => {
			await project.dispatch('addResourceToTimeline', {
				resourceId: videoResource._node_id,
			})
			await project.dispatch('addResourceToTimeline', {
				resourceId: audioResource._node_id,
			})
			await project.dispatch('addEmbeddedAudioToTimeline', {
				resourceId: videoResource._node_id,
			})
		})

		await expectProjectGraphInvariants(ctx)
		const beforeSplitVideoClipCount = (await ctx.queryRel(videoTrack, 'clips')).length

		const videoTrackClips = await ctx.queryRel(videoTrack, 'clips')
		const videoClip = videoTrackClips.find((clip) => {
			const renderData = ctx.getAttr(clip, 'clipRenderData') as { resourceId?: unknown } | null
			return renderData?.resourceId === videoResource._node_id
		})
		if (!videoClip) {
			throw new Error('Expected timeline clip for graph video resource')
		}

		await ctx.lockToRead(async () => {
			await videoClip.dispatch('splitSelfAt', { time: 1.5 })
		})

		await expectProjectGraphInvariants(ctx)

		const afterSplitVideoClips = await ctx.queryRel(videoTrack, 'clips')
		expect(afterSplitVideoClips.length).toBe(beforeSplitVideoClipCount + 1)
		let splitSourceClipCount = 0
		for (const clip of afterSplitVideoClips) {
			const resourceRel = await ctx.queryRel(clip, 'resource')
			if (resourceRel[0]?._node_id === videoResource._node_id) {
				splitSourceClipCount += 1
			}
		}
		expect(splitSourceClipCount).toBeGreaterThanOrEqual(2)

		const audioClips = await ctx.queryRel(audioTrack, 'clips')
		expect(audioClips.length).toBeGreaterThanOrEqual(1)
		await Promise.all(audioClips.map(async (clip) => {
			expect(await ctx.queryRel(clip, 'track')).toEqual([audioTrack])
		}))
	})
})
