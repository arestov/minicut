import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'
import { expectProjectGraphInvariants, expectClipTiming } from '../test/projectGraphAssertions'

const PROJECT_ID = 'test-append-start'

const setupProjectWithVideoClip = async () => {
	const ctx = await bootDktModels()

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch('createProject', {
			sourceProjectId: PROJECT_ID,
			title: 'Append Start Test',
		})
	})

	const project = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) throw new Error('No active project')

	const tracks = await ctx.queryRel(project, 'tracks')
	const videoTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'video')
	const audioTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'audio')
	if (!videoTrack) throw new Error('No video track')
	if (!audioTrack) throw new Error('No audio track')

	return { ctx, project, videoTrack, audioTrack }
}

describe('addResourceToTimeline append start', () => {
	it('video track appendStart comp is 0 when no clips exist', async () => {
		const { ctx, videoTrack } = await setupProjectWithVideoClip()

		const appendStart = ctx.getAttr(videoTrack, 'appendStart')
		expect(appendStart).toBe(0)
		await expectProjectGraphInvariants(ctx)
	})

	it('video track appendStart equals max(start+duration) after one clip', async () => {
		const { ctx, videoTrack } = await setupProjectWithVideoClip()

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch('addClip', {
				sourceClipId: 'clip:video-1',
				name: 'Video 1',
				mediaKind: 'video',
				start: 0,
				in: 0,
				duration: 1.5,
			})
		})

		const appendStart = ctx.getAttr(videoTrack, 'appendStart')
		expect(appendStart).toBe(1.5)

		const [clip] = await ctx.queryRel(videoTrack, 'clips')
		expectClipTiming(ctx, clip, {
			sourceClipId: 'clip:video-1',
			start: 0,
			duration: 1.5,
		})
		await expectProjectGraphInvariants(ctx)
	})

	it('addResourceToTimeline places new clip after existing clips via deps', async () => {
		const { ctx, project, videoTrack, audioTrack } = await setupProjectWithVideoClip()

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				sourceResourceId: 'res:video-1',
				name: 'Video 1',
				kind: 'video',
				url: 'http://test/video.webm',
				mime: 'video/webm',
				duration: 1.5,
				size: 1000,
				source: { kind: 'local', ownerPeerId: 'test-peer' },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 1000]], requested: [] },
					loadedBytes: 1000,
				},
			})
		})

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				sourceResourceId: 'res:image-1',
				name: 'Image 1',
				kind: 'image',
				url: 'http://test/image.png',
				mime: 'image/png',
				duration: 1.0,
				size: 500,
				source: { kind: 'local', ownerPeerId: 'test-peer' },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 500]], requested: [] },
					loadedBytes: 500,
				},
			})
		})

		await ctx.lockToRead(async () => {
			await project.dispatch('addResourceToTimeline', {
				sourceResourceId: 'res:image-1',
			})
		})

		const videoClipsFinal = await ctx.queryRel(videoTrack, 'clips')
		const imageClip = videoClipsFinal.find(
			(c) => String(ctx.getAttr(c, 'sourceResourceId')).includes('res:image-1'),
		)
		expect(imageClip).toBeTruthy()
		expectClipTiming(ctx, imageClip, {
			sourceResourceId: 'res:image-1',
			start: 1.5,
			duration: 1,
		})
		expect(ctx.getAttr(videoTrack, 'appendStart')).toBe(2.5)
		await expectProjectGraphInvariants(ctx)
	})

	it('addResourceToTimeline places audio clip after existing audio clips', async () => {
		const { ctx, project, audioTrack } = await setupProjectWithVideoClip()

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				sourceResourceId: 'res:video-1',
				name: 'Video 1',
				kind: 'video',
				url: 'http://test/video.webm',
				mime: 'video/webm',
				duration: 1.5,
				size: 1000,
				source: { kind: 'local', ownerPeerId: 'test-peer' },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 1000]], requested: [] },
					loadedBytes: 1000,
				},
			})
		})

		await ctx.lockToRead(async () => {
			await project.dispatch('importResource', {
				sourceResourceId: 'res:audio-1',
				name: 'Audio 1',
				kind: 'audio',
				url: 'http://test/audio.wav',
				mime: 'audio/wav',
				duration: 1.0,
				size: 800,
				source: { kind: 'local', ownerPeerId: 'test-peer' },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 800]], requested: [] },
					loadedBytes: 800,
				},
			})
		})

		// Simulate what the adapter does: when a video resource is the first on the timeline,
		// it also dispatches addEmbeddedAudioToTimeline so A1 gets the embedded audio clip.
		await ctx.lockToRead(async () => {
			await project.dispatch('addEmbeddedAudioToTimeline', {
				sourceResourceId: 'res:video-1',
			})
		})

		await ctx.lockToRead(async () => {
			await project.dispatch('addResourceToTimeline', {
				sourceResourceId: 'res:audio-1',
			})
		})

		const audioClips = await ctx.queryRel(audioTrack, 'clips')
		const toneClip = audioClips.find(
			(c) => String(ctx.getAttr(c, 'sourceResourceId')).includes('res:audio-1'),
		)
		expect(toneClip).toBeTruthy()
		expectClipTiming(ctx, toneClip, {
			sourceResourceId: 'res:audio-1',
			start: 1.5,
			duration: 1,
		})
		await expectProjectGraphInvariants(ctx)
	})
})
