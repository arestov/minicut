import { describe, expect, it } from 'vitest'
import { createActionContractHarness, dispatchAndSettle, readSourceIds } from './action-contract-test-harness'

describe('Project action contracts', () => {
	it('renameProject, setProjectFormat, and setProjectDuration update project attrs', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.project, 'renameProject', 'Renamed Coverage Project')
		await dispatchAndSettle(harness.ctx, harness.project, 'setProjectFormat', {
			fps: 24,
			width: 1280,
			height: 720,
		})
		await dispatchAndSettle(harness.ctx, harness.project, 'setProjectDuration', 27)

		expect(harness.ctx.getAttr(harness.project, 'title')).toBe('Renamed Coverage Project')
		expect(harness.ctx.getAttr(harness.project, 'fps')).toBe(24)
		expect(harness.ctx.getAttr(harness.project, 'width')).toBe(1280)
		expect(harness.ctx.getAttr(harness.project, 'height')).toBe(720)
		expect(harness.ctx.getAttr(harness.project, 'duration')).toBe(27)
	})

	it('addTrack creates a new track and setTracks can replace the project track list', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.project, 'addTrack', {
			sourceTrackId: 'coverage-project:track:fx',
			kind: 'video',
			name: 'FX',
			muted: false,
			locked: false,
			height: 72,
		})

		const trackIds = await readSourceIds(harness.ctx, harness.project, 'tracks', 'sourceTrackId')
		expect(trackIds).toContain('coverage-project:track:fx')

		const tracks = await harness.ctx.queryRel(harness.project, 'tracks')
		const fxTrack = tracks.find((track) => harness.ctx.getAttr(track, 'sourceTrackId') === 'coverage-project:track:fx')
		expect(fxTrack).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.project, 'setTracks', {
			tracks: [fxTrack!, harness.videoTrack],
		})

		const reorderedTrackIds = await readSourceIds(harness.ctx, harness.project, 'tracks', 'sourceTrackId')
		expect(reorderedTrackIds).toEqual(['coverage-project:track:fx', 'coverage-project:track:video'])
	})

	it('importResource creates a resource and addResourceToTimeline routes it to the video track', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.project, 'importResource', {
			sourceResourceId: 'res:project-video',
			name: 'Project Video Resource',
			kind: 'video',
			url: 'https://example.invalid/project-video.webm',
			mime: 'video/webm',
			duration: 5,
			size: 500,
			source: { kind: 'local' },
			status: 'ready',
			data: { status: 'ready' },
		})

		await dispatchAndSettle(harness.ctx, harness.project, 'addResourceToTimeline', {
			sourceResourceId: 'res:project-video',
		})

		const resourceIds = await readSourceIds(harness.ctx, harness.project, 'resources', 'sourceResourceId')
		expect(resourceIds).toContain('res:project-video')

		const clipIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(clipIds).toContain('res:project-video:clip')
	})

	it('addTextClipToVideoTrack creates a text clip and a text node in the root graph', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.project, 'addTextClipToVideoTrack', {
			sourceClipId: 'clip:project-text',
			sourceTextId: 'text:project-text',
			name: 'Project Text',
			mediaKind: 'text',
			start: 4,
			in: 0,
			duration: 2,
			text: {
				sourceTextId: 'text:project-text',
				content: 'Project text',
				style: { fontFamily: 'Inter', fontSize: 40, color: '#ffffff' },
				box: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 },
			},
		})

		const clipIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(clipIds).toContain('clip:project-text')

		const textIds = await readSourceIds(harness.ctx, harness.ctx.appModel, 'text', 'sourceTextId')
		expect(textIds).toContain('text:project-text')
	})
})

describe('Track action contracts', () => {
	it('renameTrack, setTrackMuted, and setTrackLocked update track attrs', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'renameTrack', 'Primary Video')
		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'setTrackMuted', true)
		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'setTrackLocked', true)

		expect(harness.ctx.getAttr(harness.videoTrack, 'name')).toBe('Primary Video')
		expect(harness.ctx.getAttr(harness.videoTrack, 'muted')).toBe(true)
		expect(harness.ctx.getAttr(harness.videoTrack, 'locked')).toBe(true)
	})

	it('addClip and removeClipBySourceId mutate the track clip list', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'addClip', {
			sourceClipId: 'clip:track-temp',
			sourceResourceId: 'res:video',
			name: 'Track Temp',
			mediaKind: 'video',
			start: 5,
			in: 0,
			duration: 2,
		})

		const trackClipIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(trackClipIds).toContain('clip:track-temp')

		const tempClip = (await harness.ctx.queryRel(harness.videoTrack, 'clips')).find(
			(clip) => harness.ctx.getAttr(clip, 'sourceClipId') === 'clip:track-temp',
		)
		expect(tempClip).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'removeClip', {
			clipId: tempClip!._node_id,
		})
		expect(await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')).not.toContain('clip:track-temp')

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'addClip', {
			sourceClipId: 'clip:track-temp-2',
			sourceResourceId: 'res:video',
			name: 'Track Temp 2',
			mediaKind: 'video',
			start: 6,
			in: 0,
			duration: 2,
		})

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'removeClipBySourceId', {
			sourceClipId: 'clip:track-temp-2',
		})
		expect(await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')).not.toContain('clip:track-temp-2')
	})

	it('setClips replaces the clip relation list in the requested order', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'addClip', {
			sourceClipId: 'clip:track-order',
			sourceResourceId: 'res:video',
			name: 'Track Order',
			mediaKind: 'video',
			start: 7,
			in: 0,
			duration: 1,
		})

		const clips = await harness.ctx.queryRel(harness.videoTrack, 'clips')
		const [firstClip, secondClip] = clips

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'setClips', {
			clips: [secondClip, firstClip],
		})

		const trackClipIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(trackClipIds[0]).toBe(harness.ctx.getAttr(secondClip, 'sourceClipId'))
		expect(trackClipIds[1]).toBe(harness.ctx.getAttr(firstClip, 'sourceClipId'))
	})
})
