import { describe, expect, it } from 'vitest'
import { createActionContractHarness, dispatchAndSettle, readNodeIds } from './action-contract-test-harness'

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
			kind: 'video',
			name: 'FX',
			muted: false,
			locked: false,
			height: 72,
		})

		const tracks = await harness.ctx.queryRel(harness.project, 'tracks')
		const fxTrack = tracks.find((track) => harness.ctx.getAttr(track, 'name') === 'FX')
		expect(fxTrack).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.project, 'setTracks', {
			tracks: [fxTrack!, harness.videoTrack],
		})

		const reorderedTrackIds = await readNodeIds(harness.ctx, harness.project, 'tracks')
		expect(reorderedTrackIds).toEqual([String(fxTrack!._node_id), String(harness.videoTrack._node_id)])
	})

	it('importResource creates a resource and addResourceToTimeline routes it to the video track', async () => {
		const harness = await createActionContractHarness()
		const videoAppendStartBefore = harness.ctx.getAttr(harness.videoTrack, 'appendStart')
		const audioAppendStartBefore = harness.ctx.getAttr(harness.audioTrack, 'appendStart')
		const audioClipIdsBefore = await readNodeIds(harness.ctx, harness.audioTrack, 'clips')

		await dispatchAndSettle(harness.ctx, harness.project, 'importResource', {
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

		const resources = await harness.ctx.queryRel(harness.project, 'resources')
		const projectVideoResource = resources.find((resource) => harness.ctx.getAttr(resource, 'name') === 'Project Video Resource')
		expect(projectVideoResource?._node_id).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.project, 'addResourceToTimeline', {
			resourceId: projectVideoResource!._node_id,
		})

		const clips = await harness.ctx.queryRel(harness.videoTrack, 'clips')
		const createdClip = clips
			.filter((clip) => String(clip._node_id) !== String(harness.videoClip._node_id))
			.sort((a, b) => Number(harness.ctx.getAttr(b, 'start')) - Number(harness.ctx.getAttr(a, 'start')))[0]
		expect(createdClip).toBeTruthy()
		const resourceRel = await harness.ctx.queryRel(createdClip!, 'resource')
		expect(resourceRel).toEqual([projectVideoResource])
		expect(harness.ctx.getAttr(createdClip!, 'start')).toBe(videoAppendStartBefore)
		expect(Number(harness.ctx.getAttr(createdClip!, 'duration'))).toBeGreaterThan(0)
		expect(harness.ctx.getAttr(harness.videoTrack, 'appendStart')).toBe(Number(videoAppendStartBefore) + 5)
		expect(harness.ctx.getAttr(harness.audioTrack, 'appendStart')).toBe(audioAppendStartBefore)
		expect(await readNodeIds(harness.ctx, harness.audioTrack, 'clips')).toEqual(audioClipIdsBefore)
	})

	it('addTextClipToVideoTrack creates a text clip and a text node in the root graph', async () => {
		const harness = await createActionContractHarness()
		const beforeClipIds = await readNodeIds(harness.ctx, harness.videoTrack, 'clips')

		await dispatchAndSettle(harness.ctx, harness.project, 'addTextClipToVideoTrack', {
			name: 'Project Text',
			mediaKind: 'text',
			start: 4,
			in: 0,
			duration: 2,
			text: {
				content: 'Project text',
				style: { fontFamily: 'Inter', fontSize: 40, color: '#ffffff' },
				box: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 },
			},
		})

		const clipIds = await readNodeIds(harness.ctx, harness.videoTrack, 'clips')
		expect(clipIds.length).toBe(beforeClipIds.length + 1)

		const textModels = await harness.ctx.queryRel(harness.ctx.appModel, 'text')
		expect(textModels.some((text) => harness.ctx.getAttr(text, 'content') === 'Project text')).toBe(true)
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

	it('addClip and removeClip mutate the track clip list', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'addClip', {
			resource: harness.videoResource,
			name: 'Track Temp',
			mediaKind: 'video',
			start: 5,
			in: 0,
			duration: 2,
		})

		const tempClip = (await harness.ctx.queryRel(harness.videoTrack, 'clips')).find(
			(clip) => harness.ctx.getAttr(clip, 'name') === 'Track Temp',
		)
		expect(tempClip).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'removeClip', {
			clipId: tempClip!._node_id,
		})
		expect((await readNodeIds(harness.ctx, harness.videoTrack, 'clips')).includes(String(tempClip!._node_id))).toBe(false)
	})

	it('removeClip is idempotent for missing clips', async () => {
		const harness = await createActionContractHarness()
		const beforeClipIds = await readNodeIds(harness.ctx, harness.videoTrack, 'clips')

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'removeClip', { clipId: 'clip-node:missing' })
		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'removeClip', { clipId: 'clip-node:missing' })
		expect(await readNodeIds(harness.ctx, harness.videoTrack, 'clips')).toEqual(beforeClipIds)
	})

	it('setClips replaces the clip relation list in the requested order', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.videoTrack, 'addClip', {
			resource: harness.videoResource,
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

		const trackClipIds = await readNodeIds(harness.ctx, harness.videoTrack, 'clips')
		expect(trackClipIds[0]).toBe(String(secondClip._node_id))
		expect(trackClipIds[1]).toBe(String(firstClip._node_id))
	})
})
