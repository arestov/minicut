import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { CMD } from '../domain/types'
import { applySnapshot, createProjectsStore } from './projectStore'
import { createSessionStore } from './sessionStore'
import {
	clipAttrs$,
	getActiveProjectId$,
	getActiveTimelineId$,
	getProjectResourceIds$,
	getTimelineTrackIds$,
	getTrackClipIds$,
	resourceAttrs$,
	trackAttrs$,
} from './observableSelectors'

const createRegistryFixture = () => {
	let registry = createEmptyRegistry()
	const projectResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: { title: 'Observable project' } })
	registry = applyPatchEnvelopeToRegistry(registry, projectResult.envelope)
	const projectId = String(projectResult.createdIds?.projectId)

	const resourceResult = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'clip.webm', kind: 'video', duration: 2, url: 'blob:clip' },
	})
	registry = applyPatchEnvelopeToRegistry(registry, resourceResult.envelope)
	const resourceId = String(resourceResult.createdIds?.resourceId)

	const clipResult = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId },
	})
	registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
	const clipId = String(clipResult.createdIds?.clipId)

	return { registry, projectId, resourceId, clipId }
}

describe('observable graph selectors', () => {
	it('reads typed project graph nodes from the existing deep observable proxy', () => {
		const { registry, projectId, resourceId, clipId } = createRegistryFixture()
		const projects$ = createProjectsStore()
		const session$ = createSessionStore()
		applySnapshot(projects$, registry)
		session$.activeProjectId.set(projectId)

		const timelineId = getActiveTimelineId$(projects$, projectId)
		expect(getActiveProjectId$(projects$, session$)).toBe(projectId)
		expect(timelineId).toEqual(expect.any(String))
		expect(getProjectResourceIds$(projects$, projectId)).toEqual([resourceId])

		const trackIds = getTimelineTrackIds$(projects$, timelineId)
		expect(trackIds.length).toBeGreaterThan(0)
		expect(trackAttrs$(projects$, trackIds[0]).kind.get()).toBe('video')
		expect(getTrackClipIds$(projects$, trackIds[0])).toContain(clipId)
		expect(resourceAttrs$(projects$, resourceId).name.get()).toBe('clip.webm')
		expect(clipAttrs$(projects$, clipId).duration.get()).toBe(2)
	})
})
