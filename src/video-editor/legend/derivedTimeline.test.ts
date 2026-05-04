import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { CMD } from '../domain/types'
import { createSessionStore } from './sessionStore'
import { applySnapshot, createProjectsStore } from './projectStore'
import {
	createPlaybackDuration$,
	createPreviewScene$,
	createSelectedClipTrackPosition$,
	createTrackEnd$,
} from './derivedTimeline'
import { getActiveTimelineId$, getTimelineTrackIds$ } from './observableSelectors'

const createRegistryFixture = () => {
	let registry = createEmptyRegistry()
	const projectResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: { title: 'Derived project' } })
	registry = applyPatchEnvelopeToRegistry(registry, projectResult.envelope)
	const projectId = String(projectResult.createdIds?.projectId)

	const resourceResult = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'clip.webm', kind: 'video', duration: 2, url: 'blob:clip', mime: 'video/webm' },
	})
	registry = applyPatchEnvelopeToRegistry(registry, resourceResult.envelope)
	const resourceId = String(resourceResult.createdIds?.resourceId)

	const clipResult = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId },
	})
	registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
	const clipId = String(clipResult.createdIds?.clipId)

	return { registry, projectId, clipId, resourceId }
}

describe('derived timeline selectors', () => {
	it('derives playback duration and active preview scene from observable graph nodes', () => {
		const { registry, projectId, clipId, resourceId } = createRegistryFixture()
		const projects$ = createProjectsStore()
		const session$ = createSessionStore()
		applySnapshot(projects$, registry)
		session$.activeProjectId.set(projectId)

		const previewScene$ = createPreviewScene$(projects$, session$)
		const playbackDuration$ = createPlaybackDuration$(projects$, session$)
		const timelineId = getActiveTimelineId$(projects$, projectId)
		const trackId = getTimelineTrackIds$(projects$, timelineId)[0]
		const trackEnd$ = createTrackEnd$(projects$, trackId)
		const selectedClipTrackPosition$ = createSelectedClipTrackPosition$(projects$, session$)

		session$.cursor.set(0.5)
		session$.selectedEntityId.set(clipId)

		expect(playbackDuration$.get()).toBe(2)
		expect(trackEnd$.get()).toBe(2)
		expect(selectedClipTrackPosition$.get()).toMatchObject({ trackId, trackName: 'V1', ordinal: 1 })
		expect(previewScene$.get().activeClipNames).toEqual(['clip.webm'])
		expect(previewScene$.get().renderedClips[0]).toMatchObject({
			id: clipId,
			resourceId,
			name: 'clip.webm',
			resourceKind: 'video',
			resourceUrl: 'blob:clip',
		})

		session$.cursor.set(2.5)
		expect(previewScene$.get().activeClipNames).toEqual([])
	})

	it('keeps muted tracks out of preview while preserving playback duration', () => {
		const { registry, projectId } = createRegistryFixture()
		const projects$ = createProjectsStore()
		const session$ = createSessionStore()
		applySnapshot(projects$, registry)
		session$.activeProjectId.set(projectId)
		const previewScene$ = createPreviewScene$(projects$, session$)
		const playbackDuration$ = createPlaybackDuration$(projects$, session$)
		const timelineId = getActiveTimelineId$(projects$, projectId)
		const trackId = getTimelineTrackIds$(projects$, timelineId)[0]

		projects$.entitiesById[trackId].attrs.muted.set(true)
		session$.cursor.set(0.5)

		expect(playbackDuration$.get()).toBe(2)
		expect(previewScene$.get().renderedClips).toEqual([])
		expect(previewScene$.get().activeClipNames).toEqual([])
	})

	it('derives primary color correction filters for the active preview frame', () => {
		let { registry, projectId, clipId } = createRegistryFixture()
		registry = applyPatchEnvelopeToRegistry(registry, buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Primary', kind: 'color-correction' },
		}).envelope)
		const effectId = String(registry.entitiesById[clipId].rels.effects?.[0])
		registry = applyPatchEnvelopeToRegistry(registry, buildDispatchResult(registry, {
			c: CMD.EFFECT_UPDATE_ATTRS,
			p: {
				id: effectId,
				attrs: { params: { exposure: { value: 0.25 }, contrast: { value: 1.2 }, saturation: { value: 1.5 } } },
			},
		}).envelope)

		const projects$ = createProjectsStore()
		const session$ = createSessionStore()
		applySnapshot(projects$, registry)
		session$.activeProjectId.set(projectId)
		session$.cursor.set(0.5)

		expect(createPreviewScene$(projects$, session$).get().renderedClips[0].filters).toEqual([
			'brightness(1.25) contrast(1.2) saturate(1.5) hue-rotate(0deg)',
		])
	})

	it('derives edited text attrs for the active preview frame', () => {
		let { registry, projectId } = createRegistryFixture()
		const textResult = buildDispatchResult(registry, {
			c: CMD.TEXT_ADD,
			p: { projectId, content: 'Original title', start: 0, duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, textResult.envelope)
		registry = applyPatchEnvelopeToRegistry(registry, buildDispatchResult(registry, {
			c: CMD.TEXT_UPDATE_ATTRS,
			p: { id: String(textResult.createdIds?.textId), attrs: { content: 'Edited title' } },
		}).envelope)

		const projects$ = createProjectsStore()
		const session$ = createSessionStore()
		applySnapshot(projects$, registry)
		session$.activeProjectId.set(projectId)
		session$.cursor.set(0.5)

		const textClip = createPreviewScene$(projects$, session$).get().renderedClips.find((clip) => clip.resourceKind === 'text')
		expect(textClip?.text?.content).toBe('Edited title')
	})
})
