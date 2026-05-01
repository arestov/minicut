import { createVideoEditorHarness } from './createVideoEditorHarness'
import { MemoryWorkerAuthority } from '../worker/memoryWorker'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getResourceEntities } from '../domain/selectors'
import { CMD, type ResourceAttrs } from '../domain/types'
import { createEmptyRegistry } from '../domain/createProject'
import type { EditorAuthorityClient } from '../worker/authorityClient'

const flushMicrotasks = async () => {
	await Promise.resolve()
	await Promise.resolve()
}

const settleHarness = async () => {
	await flushMicrotasks()
	await flushMicrotasks()
}

describe('createVideoEditorHarness actions', () => {
	it('filters unsupported files in importFiles', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			const file = blob as File
			return `blob:${file.name}`
		})
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()

			harness.actions.importFiles([
				new File(['notes'], 'notes.txt', { type: 'text/plain' }),
				new File(['video'], 'clip.webm', { type: 'video/webm' }),
			])
			await settleHarness()

			const registry = harness.projects$.get()
			const project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			const resources = getResourceEntities(registry, project!)
			expect(resources).toHaveLength(1)
			expect((resources[0].attrs as ResourceAttrs).name).toBe('clip.webm')
			expect(createObjectURL).toHaveBeenCalledTimes(1)
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:clip.webm')
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('tracks in-point and clamps trim start to keep positive duration', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()
			harness.actions.addResourceToTimeline(
				String(getResourceEntities(harness.projects$.get(), getActiveProject(harness.projects$.get(), harness.session$.get())!)[0].id),
			)
			await settleHarness()

			harness.actions.trimSelectedClip('start', 10)
			await settleHarness()

			const clipId = harness.session$.selectedEntityId.get()
			expect(clipId).not.toBeNull()
			const clipAttrs = harness.projects$.entitiesById[String(clipId)].attrs.get() as {
				start: number
				in: number
				duration: number
			}
			expect(clipAttrs.start).toBe(4.5)
			expect(clipAttrs.in).toBe(4.5)
			expect(clipAttrs.duration).toBe(0.5)
		} finally {
			harness.destroy()
		}
	})

	it('wraps cursor in tickPlayback and routes audio clips to the audio track', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			const projectId = String(harness.session$.activeProjectId.get())

			const audioImport = authority.dispatch({
				c: CMD.RESOURCE_IMPORT,
				p: { projectId, name: 'Narration', kind: 'audio', duration: 2.5 },
			})
			const resourceId = String(audioImport.createdIds?.resourceId)

			harness.actions.addResourceToTimeline(resourceId)
			await settleHarness()

			const registry = harness.projects$.get()
			const project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			const audioTrack = getAudioTrack(registry, project!)
			expect(audioTrack).not.toBeNull()
			const clipIds = getClipIdsForTrack(registry, String(audioTrack?.id))
			expect(clipIds).toHaveLength(1)

			harness.session$.cursor.set(19.8)
			harness.session$.isPlaying.set(true)
			harness.actions.tickPlayback(0.5)
			expect(harness.session$.cursor.get()).toBeCloseTo(0.3, 5)
		} finally {
			harness.destroy()
		}
	})

	it('skips dispatching move command when delta is zero', () => {
		const dispatch = vi.fn(() => {
			throw new Error('move dispatch should not be called for zero delta')
		})
		const authority: EditorAuthorityClient = {
			getSnapshot: () => createEmptyRegistry(),
			subscribe: () => () => {},
			dispatch,
		}
		const harness = createVideoEditorHarness(authority)

		try {
			expect(() => harness.actions.moveClipById('clip:noop', 0)).not.toThrow()
			expect(dispatch).not.toHaveBeenCalled()
		} finally {
			harness.destroy()
		}
	})
})
