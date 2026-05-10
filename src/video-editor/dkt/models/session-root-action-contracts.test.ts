import { describe, expect, it } from 'vitest'
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from '../../models/sessionZoom'
import { createActionContractHarness, dispatchAndSettle, readSourceIds } from './action-contract-test-harness'

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

	it('nudgeSelectedClip, splitSelectedClip, and deleteSelectedClip act on the selected clip', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'selectEntity', 'clip:video')
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'nudgeSelectedClip', { delta: 0.5 })
		expect(harness.ctx.getAttr(harness.videoClip, 'start')).toBe(1.5)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'setCursor', 3)
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'splitSelectedClip')
		const videoClipIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(videoClipIds.length).toBeGreaterThan(1)

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, 'deleteSelectedClip')
		const afterDeleteIds = await readSourceIds(harness.ctx, harness.videoTrack, 'clips', 'sourceClipId')
		expect(afterDeleteIds).not.toContain('clip:video')
		expect(harness.ctx.getAttr(harness.sessionRoot, 'selectedEntityId')).toBeNull()
	})
})
