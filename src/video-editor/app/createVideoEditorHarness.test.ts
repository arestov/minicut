import { createVideoEditorHarness } from './createVideoEditorHarness'
import { MemoryWorkerAuthority } from '../worker/memoryWorker'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getResourceEntities, getVideoTrack } from '../domain/selectors'
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

const mockMediaElementDuration = (options: { duration?: number, fail?: boolean }) => {
	const originalCreateElement = document.createElement.bind(document)
	return vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
		if (tagName !== 'video' && tagName !== 'audio') {
			return originalCreateElement(tagName)
		}

		const element = {
			preload: '',
			duration: options.duration ?? Number.NaN,
			onloadedmetadata: null as null | (() => void),
			onerror: null as null | (() => void),
			removeAttribute: vi.fn(),
			load: vi.fn(() => {
				queueMicrotask(() => {
					if (options.fail) {
						element.onerror?.()
						return
					}

					element.onloadedmetadata?.()
				})
			}),
		}

		return element as unknown as HTMLElement
	}) as typeof document.createElement)
}

describe('createVideoEditorHarness actions', () => {
	it('filters unsupported files and imports real media duration from metadata', async () => {
		const createElement = mockMediaElementDuration({ duration: 12.75 })
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
			expect((resources[0].attrs as ResourceAttrs).duration).toBe(12.75)
			expect(createObjectURL).toHaveBeenCalledTimes(1)
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:clip.webm')
			createElement.mockRestore()
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('uses one second for images and fallback duration when media metadata fails', async () => {
		const createElement = mockMediaElementDuration({ fail: true })
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
				new File(['image'], 'still.png', { type: 'image/png' }),
				new File(['audio'], 'bad.wav', { type: 'audio/wav' }),
			])
			await settleHarness()

			const registry = harness.projects$.get()
			const project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			const resources = getResourceEntities(registry, project!)
			expect(resources.map((resource) => (resource.attrs as ResourceAttrs).duration)).toEqual([1, 6])
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:still.png')
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:bad.wav')
			createElement.mockRestore()
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

	it('splits selected clip at playhead and keeps resulting durations aligned', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			const project = getActiveProject(harness.projects$.get(), harness.session$.get())
			expect(project).not.toBeNull()
			const resources = getResourceEntities(harness.projects$.get(), project!)
			harness.actions.addResourceToTimeline(String(resources[0].id))
			await settleHarness()

			const clipId = String(harness.session$.selectedEntityId.get())
			harness.actions.setCursor(1.25)
			harness.actions.splitSelectedClip()
			await settleHarness()

			const nextRegistry = harness.projects$.get()
			const nextProject = getActiveProject(nextRegistry, harness.session$.get())
			expect(nextProject).not.toBeNull()
			const videoTrack = getVideoTrack(nextRegistry, nextProject!)
			expect(videoTrack).not.toBeNull()
			const clipIds = getClipIdsForTrack(nextRegistry, String(videoTrack?.id))
			expect(clipIds).toHaveLength(2)

			const leftAttrs = nextRegistry.entitiesById[clipId].attrs as { duration: number }
			const rightClipId = clipIds.find((id) => id !== clipId)
			expect(rightClipId).toBeTruthy()
			const rightAttrs = nextRegistry.entitiesById[String(rightClipId)].attrs as { start: number, duration: number }
			expect(rightAttrs.start).toBe(1.25)
			expect(leftAttrs.duration).toBe(1.25)
			expect(leftAttrs.duration + rightAttrs.duration).toBeCloseTo(5, 5)
		} finally {
			harness.destroy()
		}
	})

	it('removes a single effect from selected clip', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			const project = getActiveProject(harness.projects$.get(), harness.session$.get())
			expect(project).not.toBeNull()
			const resources = getResourceEntities(harness.projects$.get(), project!)
			harness.actions.addResourceToTimeline(String(resources[0].id))
			await settleHarness()

			harness.actions.addEffectToSelectedClip('blur')
			harness.actions.addEffectToSelectedClip('sharpen')
			await settleHarness()

			const clipId = String(harness.session$.selectedEntityId.get())
			const beforeEffects = harness.projects$.entitiesById[clipId].rels.effects.get()
			expect(Array.isArray(beforeEffects)).toBe(true)
			expect(beforeEffects).toHaveLength(2)
			const beforeEffectIds = Array.isArray(beforeEffects) ? [...beforeEffects] : []

			const removedEffectId = String(beforeEffectIds[0])
			harness.actions.removeEffectFromSelectedClip(removedEffectId)
			await settleHarness()

			const afterEffects = harness.projects$.entitiesById[clipId].rels.effects.get()
			expect(afterEffects).toEqual([String(beforeEffectIds[1])])
			expect(harness.projects$.entitiesById[removedEffectId].get()).toBeUndefined()
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

			harness.session$.cursor.set(2.3)
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
		const harness = createVideoEditorHarness(authority, { autoCreateInitialProject: false })

		try {
			expect(() => harness.actions.moveClipById('clip:noop', 0)).not.toThrow()
			expect(dispatch).not.toHaveBeenCalled()
		} finally {
			harness.destroy()
		}
	})
})
