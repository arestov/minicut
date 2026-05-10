import { describe, expect, it } from 'vitest'
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from '../../models/sessionZoom'
import { createActionContractHarness, dispatchAndSettle, findBySourceId, readSourceIds } from './action-contract-test-harness'

describe('SessionRoot action contracts', () => {
	it('bootstraps exactly one project and does not duplicate on repeated handleInit', async () => {
		const harness = await createActionContractHarness()

		const projectsBefore = await harness.ctx.queryRel(harness.ctx.appModel, 'project')
		expect(projectsBefore.length).toBeGreaterThanOrEqual(1)
		const initialProjectCount = projectsBefore.length

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'handleInit')

		const projectsAfter = await harness.ctx.queryRel(harness.ctx.appModel, 'project')
		expect(projectsAfter).toHaveLength(initialProjectCount)
		expect(typeof harness.ctx.getAttr(projectsAfter[0], 'sourceProjectId')).toBe('string')
	})

	it('createProject switches active project and clears editor state', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'createProject', {
			sourceProjectId: 'project:session-root-new',
			title: 'New Project',
		})

		expect(harness.ctx.getAttr(harness.sessionRoot, 'activeProjectId')).toBe('project:session-root-new')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'selectedEntityId')).toBeNull()
		expect(harness.ctx.getAttr(harness.sessionRoot, 'cursor')).toBe(0)
	})

	it('selectEntity resolves selectedClip and summary from the current graph', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')

		expect(harness.ctx.getAttr(harness.sessionRoot, 'selectedEntityId')).toBe('clip:video')
		const selectedClip = (await harness.ctx.queryRel(harness.sessionRoot, 'selectedClip'))[0]
		expect(harness.ctx.getAttr(selectedClip, 'sourceClipId')).toBe('clip:video')
		const summary = harness.ctx.getAttr(harness.sessionRoot, 'selectedClipSummary') as { resourceName?: string } | null
		expect(summary?.resourceName).toBe('Video Clip')
	})

	it('setActiveProject resets selection and cursor', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setCursor', 3.5)
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setActiveProject', 'coverage-project')

		expect(harness.ctx.getAttr(harness.sessionRoot, 'selectedEntityId')).toBeNull()
		expect(harness.ctx.getAttr(harness.sessionRoot, 'cursor')).toBe(0)
	})

	it('setActiveInspectorTab only accepts valid tabs', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setActiveInspectorTab', 'audio')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'activeInspectorTab')).toBe('audio')

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setActiveInspectorTab', 'not-a-tab')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'activeInspectorTab')).toBe('audio')
	})

	it('setCursor rounds and clamps, and zoom actions obey bounds', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setCursor', -1)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'cursor')).toBe(0)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setCursor', 1.239)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'cursor')).toBe(1.24)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setTimelineZoom', 1)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'timelineZoom')).toBe(TIMELINE_ZOOM_MIN)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'zoomTimeline', 999)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'timelineZoom')).toBe(TIMELINE_ZOOM_MAX)
	})

	it('playback actions toggle state and tick when playing', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setPlaying', true)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'isPlaying')).toBe(true)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'tickPlayback', { deltaSeconds: 0.5 })
		expect(harness.ctx.getAttr(harness.sessionRoot, 'cursor')).toBe(0.5)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'togglePlayback')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'isPlaying')).toBe(false)
	})

	it('preview buffer actions create, advance, and clear buffer', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'startPreviewBuffer')
		const previewBuffer = harness.ctx.getAttr(harness.sessionRoot, 'previewBuffer') as { startCursor?: number } | null
		expect(previewBuffer).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setPlaying', true)
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'tickPlayback', { deltaSeconds: 0.5 })
		expect(harness.ctx.getAttr(harness.sessionRoot, 'cursor')).toBe(0.5)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'previewBuffer')).toBeTruthy()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'clearPreviewBuffer')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'previewBuffer')).toBeNull()
	})

	it('addTextClipToTimeline forwards to the project video track and selects the new clip', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'addTextClipToTimeline', {
			sourceClipId: 'clip:text-session',
			sourceTextId: 'text:session',
			name: 'Session Text',
			mediaKind: 'text',
			start: 6,
			in: 0,
			duration: 2,
			text: {
				sourceTextId: 'text:session',
				content: 'Session text',
			},
		})

		const ids = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(ids).toContain('clip:text-session')
		const textIds = await readSourceIds(harness.ctx, harness.ctx.appModel, 'text', 'sourceTextId')
		expect(textIds).toContain('text:session')
	})

	it('nudgeSelectedClip moves the selected clip by the requested delta', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'nudgeSelectedClip', { delta: 0.5 })

		expect(harness.ctx.getAttr(harness.videoClip, 'start')).toBe(1.5)
	})

	it('nudgeSelectedClip ignores invalid deltas and missing selections', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'nudgeSelectedClip', { delta: 0.5 })
		expect(harness.ctx.getAttr(harness.videoClip, 'start')).toBe(1)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'nudgeSelectedClip', { delta: Number.NaN })
		expect(harness.ctx.getAttr(harness.videoClip, 'start')).toBe(1)
	})

	it('splitSelectedClip creates exactly one right clip with source and track invariants', async () => {
		const harness = await createActionContractHarness()
		const beforeClips = await harness.ctx.queryRel(harness.videoTrack, 'clips')
		const beforeSourceIds = beforeClips.map((clip) => String(harness.ctx.getAttr(clip, 'sourceClipId')))

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setCursor', 3)
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'splitSelectedClip')

		const afterClips = await harness.ctx.queryRel(harness.videoTrack, 'clips')
		const afterSourceIds = afterClips.map((clip) => String(harness.ctx.getAttr(clip, 'sourceClipId')))
		const rightSourceIds = afterSourceIds.filter((sourceId) => !beforeSourceIds.includes(sourceId))
		expect(afterClips).toHaveLength(beforeClips.length + 1)
		expect(rightSourceIds).toHaveLength(1)
		expect(harness.ctx.getAttr(harness.videoClip, 'start')).toBe(1)
		expect(harness.ctx.getAttr(harness.videoClip, 'duration')).toBe(2)

		const rightClip = await findBySourceId(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId', rightSourceIds[0])
		expect(rightClip).toBeTruthy()
		expect(harness.ctx.getAttr(rightClip!, 'start')).toBe(3)
		expect(harness.ctx.getAttr(rightClip!, 'duration')).toBe(2)
		expect(harness.ctx.getAttr(rightClip!, 'in')).toBe(2)
		expect(harness.ctx.getAttr(rightClip!, 'sourceResourceId')).toBe('res:video')
	})

	it('splitSelectedClip is a no-op without a selected clip or a valid split point', async () => {
		const harness = await createActionContractHarness()
		const beforeSourceIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'splitSelectedClip')
		expect(await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')).toEqual(beforeSourceIds)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setCursor', 99)
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'splitSelectedClip')
		expect(await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')).toEqual(beforeSourceIds)
	})

	it('deleteSelectedClip removes the selected clip and clears selection', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'deleteSelectedClip')

		const afterDeleteIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(afterDeleteIds).not.toContain('clip:video')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'selectedEntityId')).toBeNull()
	})

	it('deleteSelectedClip clears stale selection without removing unrelated clips', async () => {
		const harness = await createActionContractHarness()
		const beforeVideoIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		const beforeAudioIds = await readSourceIds(harness.ctx, harness.audioTrack, 'clips', 'sourceClipId')

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:missing')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'deleteSelectedClip')

		expect(await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')).toEqual(beforeVideoIds)
		expect(await readSourceIds(harness.ctx, harness.audioTrack, 'clips', 'sourceClipId')).toEqual(beforeAudioIds)
		expect(harness.ctx.getAttr(harness.sessionRoot, 'selectedEntityId')).toBeNull()
	})
})
