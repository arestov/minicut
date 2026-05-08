import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

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
		console.log('[test] empty video track appendStart =', appendStart)
		expect(appendStart).toBe(0)
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

		const clips = await ctx.queryRel(videoTrack, 'clips')
		console.log('[test] clips count =', clips.length)
		for (const clip of clips) {
			console.log('[test] clip attrs:', {
				sourceClipId: ctx.getAttr(clip, 'sourceClipId'),
				start: ctx.getAttr(clip, 'start'),
				duration: ctx.getAttr(clip, 'duration'),
			})
		}

		const appendStart = ctx.getAttr(videoTrack, 'appendStart')
		console.log('[test] video track appendStart after 1 clip =', appendStart)
		expect(appendStart).toBe(1.5)
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

		const resources = await ctx.queryRel(project, 'resources')
		console.log('[test] resources after import:', resources.length)
		for (const r of resources) {
			console.log('[test] resource:', {
				sourceResourceId: ctx.getAttr(r, 'sourceResourceId'),
				kind: ctx.getAttr(r, 'kind'),
				duration: ctx.getAttr(r, 'duration'),
				timelineClipSource: ctx.getAttr(r, 'timelineClipSource'),
			})
		}

		const videoClips = await ctx.queryRel(videoTrack, 'clips')
		console.log('[test] video clips after import:', videoClips.length)
		for (const c of videoClips) {
			console.log('[test] video clip:', {
				sourceClipId: ctx.getAttr(c, 'sourceClipId'),
				start: ctx.getAttr(c, 'start'),
				duration: ctx.getAttr(c, 'duration'),
			})
		}

		const audioClips = await ctx.queryRel(audioTrack, 'clips')
		console.log('[test] audio clips after import:', audioClips.length)
		for (const c of audioClips) {
			console.log('[test] audio clip:', {
				sourceClipId: ctx.getAttr(c, 'sourceClipId'),
				start: ctx.getAttr(c, 'start'),
				duration: ctx.getAttr(c, 'duration'),
			})
		}

		console.log('[test] video track appendStart =', ctx.getAttr(videoTrack, 'appendStart'))
		console.log('[test] audio track appendStart =', ctx.getAttr(audioTrack, 'appendStart'))

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

		console.log('[test] after importing image resource:')
		const videoClipsAfterImage = await ctx.queryRel(videoTrack, 'clips')
		for (const c of videoClipsAfterImage) {
			console.log('[test] video clip:', {
				sourceClipId: ctx.getAttr(c, 'sourceClipId'),
				start: ctx.getAttr(c, 'start'),
				duration: ctx.getAttr(c, 'duration'),
			})
		}
		console.log('[test] video track appendStart after image =', ctx.getAttr(videoTrack, 'appendStart'))

		await ctx.lockToRead(async () => {
			await project.dispatch('addResourceToTimeline', {
				sourceResourceId: 'res:image-1',
			})
		})

		const videoClipsFinal = await ctx.queryRel(videoTrack, 'clips')
		console.log('[test] video clips after addResourceToTimeline(image):', videoClipsFinal.length)
		for (const c of videoClipsFinal) {
			console.log('[test] video clip:', {
				sourceClipId: ctx.getAttr(c, 'sourceClipId'),
				start: ctx.getAttr(c, 'start'),
				duration: ctx.getAttr(c, 'duration'),
			})
		}

		console.log('[test] video track appendStart final =', ctx.getAttr(videoTrack, 'appendStart'))

		const imageClip = videoClipsFinal.find(
			(c) => String(ctx.getAttr(c, 'sourceResourceId')).includes('res:image-1'),
		)
		expect(imageClip).toBeTruthy()
		const imageStart = ctx.getAttr(imageClip!, 'start')
		console.log('[test] image clip start =', imageStart)
		expect(imageStart).toBe(1.5)
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

		console.log('[test] audio track appendStart after embedded audio =', ctx.getAttr(audioTrack, 'appendStart'))

		await ctx.lockToRead(async () => {
			await project.dispatch('addResourceToTimeline', {
				sourceResourceId: 'res:audio-1',
			})
		})

		const audioClips = await ctx.queryRel(audioTrack, 'clips')
		console.log('[test] audio clips after addResourceToTimeline:', audioClips.length)
		for (const c of audioClips) {
			console.log('[test] audio clip:', {
				sourceClipId: ctx.getAttr(c, 'sourceClipId'),
				start: ctx.getAttr(c, 'start'),
				duration: ctx.getAttr(c, 'duration'),
			})
		}

		const toneClip = audioClips.find(
			(c) => String(ctx.getAttr(c, 'sourceResourceId')).includes('res:audio-1'),
		)
		expect(toneClip).toBeTruthy()
		const toneStart = ctx.getAttr(toneClip!, 'start')
		console.log('[test] audio clip start =', toneStart)
		expect(toneStart).toBe(1.5)
	})
})
