import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'
import {
	expectProjectGraphInvariants,
	findClipBySourceClipId,
	findTrackByKind,
	readProjectGraph,
} from '../test/projectGraphAssertions'

const PROJECT_ID = 'test-graph-invariants'

const setupProject = async () => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', {
			sourceProjectId: PROJECT_ID,
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
				sourceResourceId: 'res:graph-video',
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

		await expectProjectGraphInvariants(ctx)

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				sourceResourceId: 'res:graph-audio',
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

		await ctx.lockToRead(async () => {
			await project.dispatch('addResourceToTimeline', {
				sourceResourceId: 'res:graph-audio',
			})
			await project.dispatch('addEmbeddedAudioToTimeline', {
				sourceResourceId: 'res:graph-video',
			})
		})

		await expectProjectGraphInvariants(ctx)

		const videoClip = await findClipBySourceClipId(ctx, 'res:graph-video:clip')
		await ctx.lockToRead(async () => {
			await videoClip.dispatch('splitSelfAt', { time: 1.5 })
		})

		await expectProjectGraphInvariants(ctx)

		const { clips } = await readProjectGraph(ctx)
		const clipTracks = await Promise.all(clips.map(async (clip) => [clip, await ctx.queryRel(clip, 'track')] as const))
		const videoClips = clipTracks
			.filter(([, tracks]) => tracks[0] === videoTrack)
			.map(([clip]) => clip)
		expect(videoClips).toHaveLength(2)

		const totalDuration = videoClips.reduce((sum, clip) => sum + Number(ctx.getAttr(clip, 'duration')), 0)
		expect(totalDuration).toBeCloseTo(3, 6)

		const audioClips = await ctx.queryRel(audioTrack, 'clips')
		expect(audioClips.length).toBeGreaterThanOrEqual(2)
		await Promise.all(audioClips.map(async (clip) => {
			expect(await ctx.queryRel(clip, 'track')).toEqual([audioTrack])
		}))
	})
})
