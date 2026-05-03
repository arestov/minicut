import { createVideoEditorHarness } from './createVideoEditorHarness'
import { MemoryWorkerAuthority } from '../worker/memoryWorker'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getResourceEntities, getVideoTrack } from '../domain/selectors'
import { CMD, type ResourceAttrs } from '../domain/types'
import { createEmptyRegistry } from '../domain/createProject'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import type { ExportProgressEvent, ExportRenderRequest } from '../render/exportRenderer'
import type { VideoEditorHarnessPlatform } from './platform'

const flushMicrotasks = async () => {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve()
	}
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
	it('does not auto-create an initial project when authority is already a p2p client', async () => {
		const authority = new MemoryWorkerAuthority() as MemoryWorkerAuthority & { role?: 'server' | 'client' | 'undecided' }
		authority.role = 'client'
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			expect(Object.keys(harness.projects$.get().projects)).toHaveLength(0)
			expect(harness.session$.activeProjectId.get()).toBeNull()
		} finally {
			harness.destroy()
		}
	})

	it('auto-creates exactly one initial project when authority is server', async () => {
		const authority = new MemoryWorkerAuthority() as MemoryWorkerAuthority & { role?: 'server' | 'client' | 'undecided' }
		authority.role = 'server'
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			expect(Object.keys(harness.projects$.get().projects)).toHaveLength(1)
			expect(harness.session$.activeProjectId.get()).not.toBeNull()
		} finally {
			harness.destroy()
		}
	})

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
			expect((resources[0].attrs as unknown as ResourceAttrs).name).toBe('clip.webm')
			expect((resources[0].attrs as unknown as ResourceAttrs).duration).toBe(12.75)
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
			expect(resources.map((resource) => (resource.attrs as unknown as ResourceAttrs).duration)).toEqual([1, 6])
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:still.png')
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:bad.wav')
			createElement.mockRestore()
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('does not dispatch async media imports after destroy', async () => {
		const createElement = mockMediaElementDuration({ duration: 9 })
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			const file = blob as File
			return `blob:${file.name}`
		})
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const authority = new MemoryWorkerAuthority()
		const createResult = authority.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
		const projectId = String(createResult.createdIds?.projectId)
		const harness = createVideoEditorHarness(authority, { autoCreateInitialProject: false })

		try {
			await settleHarness()
			harness.actions.importFiles([new File(['video'], 'late.webm', { type: 'video/webm' })])
			harness.destroy()
			await settleHarness()

			const snapshot = authority.getSnapshot()
			const project = snapshot.projects[projectId]
			expect(project).toBeDefined()
			expect(getResourceEntities(snapshot, project)).toHaveLength(0)
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:late.webm')
		} finally {
			createElement.mockRestore()
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('uses injected platform adapters for media duration and object URL lifecycle', async () => {
		const authority = new MemoryWorkerAuthority()
		const createObjectUrl = vi.fn((blob: Blob) => {
			if (blob instanceof File) {
				return `custom:${blob.name}`
			}

			return 'custom:export'
		})
		const revokeObjectUrl = vi.fn()
		const getImportedResourceDuration = vi.fn(async () => 7.5)
		const platform: VideoEditorHarnessPlatform = {
			createAuthorityClient: () => authority,
			createExportRenderer: () => ({
				render: async () => ({
					id: 'export-platform',
					fileName: 'platform.webm',
					mimeType: 'video/webm',
					blob: new Blob(['video'], { type: 'video/webm' }),
					size: 5,
					duration: 1,
					frameCount: 30,
					manifest: {
						format: 'video-webm',
						projectId: 'project:1',
						range: { type: 'project' },
						start: 0,
						duration: 1,
						fps: 30,
						frameCount: 30,
						clips: [],
						frames: [],
					},
				}),
			}),
			getImportedResourceDuration,
			createObjectUrl,
			revokeObjectUrl,
			setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
			clearTimeout: (timerId) => clearTimeout(timerId),
		}

		const harness = createVideoEditorHarness(undefined, { platform })

		try {
			await settleHarness()

			harness.actions.importFiles([new File(['video'], 'clip.webm', { type: 'video/webm' })])
			await settleHarness()

			const registry = harness.projects$.get()
			const project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			const resources = getResourceEntities(registry, project!)
			expect(resources).toHaveLength(1)
			expect((resources[0].attrs as unknown as ResourceAttrs).duration).toBe(7.5)
			expect(getImportedResourceDuration).toHaveBeenCalledWith('custom:clip.webm', 'video')
			expect(createObjectUrl).toHaveBeenCalled()
		} finally {
			harness.destroy()
			expect(revokeObjectUrl).toHaveBeenCalledWith('custom:clip.webm')
		}
	})

	it('auto-adds an imported sample only when the timeline is empty', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()

			harness.actions.importSampleResource()
			await settleHarness()

			let registry = harness.projects$.get()
			let project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			let videoTrack = getVideoTrack(registry, project!)
			expect(videoTrack).not.toBeNull()
			expect(getClipIdsForTrack(registry, String(videoTrack?.id))).toHaveLength(1)

			harness.actions.importSampleResource()
			await settleHarness()

			registry = harness.projects$.get()
			project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			videoTrack = getVideoTrack(registry, project!)
			expect(videoTrack).not.toBeNull()
			expect(getResourceEntities(registry, project!)).toHaveLength(2)
			expect(getClipIdsForTrack(registry, String(videoTrack?.id))).toHaveLength(1)
		} finally {
			harness.destroy()
		}
	})

	it('uses session activeProjectId over registry activeProjectId when both are valid', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject('Session preferred')
			await settleHarness()
			harness.actions.createProject('Registry fallback')
			await settleHarness()

			const projectIds = Object.keys(harness.projects$.projects.get())
			expect(projectIds.length).toBeGreaterThanOrEqual(2)
			const sessionProjectId = String(projectIds[0])
			const registryProjectId = String(projectIds[1])

			harness.session$.activeProjectId.set(sessionProjectId)
			harness.projects$.activeProjectId.set(registryProjectId)

			harness.actions.importSampleResource()
			await settleHarness()

			const registry = harness.projects$.get()
			const sessionProject = registry.projects[sessionProjectId]
			const registryProject = registry.projects[registryProjectId]
			expect(getResourceEntities(registry, sessionProject)).toHaveLength(1)
			expect(getResourceEntities(registry, registryProject)).toHaveLength(0)
		} finally {
			harness.destroy()
		}
	})

	it('falls back to registry activeProjectId when session activeProjectId is stale', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject('Fallback project')
			await settleHarness()

			const projectId = String(harness.session$.activeProjectId.get())
			harness.session$.activeProjectId.set('project:missing')
			harness.projects$.activeProjectId.set(projectId)

			harness.actions.importSampleResource()
			await settleHarness()

			const registry = harness.projects$.get()
			const project = registry.projects[projectId]
			expect(getResourceEntities(registry, project)).toHaveLength(1)
			expect(harness.session$.activeProjectId.get()).toBe(projectId)
		} finally {
			harness.destroy()
		}
	})

	it('exports the selected clip as a render manifest and revokes its download URL', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:export-manifest')
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			const result = await harness.actions.queueSelectedClipExport()

			expect(result).not.toBeNull()
			expect(result?.downloadUrl).toBe('blob:export-manifest')
			expect(result?.manifest.range).toEqual({ type: 'clip', clipId: String(harness.session$.selectedEntityId.get()) })
			expect(result?.manifest.frames.length).toBeGreaterThan(0)
			expect(createObjectURL).toHaveBeenCalledWith(result?.blob)
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:export-manifest')
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('exports the active project as a render manifest', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:project-export')
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			const result = await harness.actions.queueProjectExport()

			expect(result).not.toBeNull()
			expect(result?.downloadUrl).toBe('blob:project-export')
			expect(result?.manifest.range).toEqual({ type: 'project' })
			expect(result?.manifest.clips.length).toBeGreaterThan(0)
			expect(createObjectURL).toHaveBeenCalledWith(result?.blob)
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:project-export')
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('requests video-webm format from project export renderer', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:project-video-export')
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const render = vi.fn(async () => ({
			id: 'export-video',
			fileName: 'project.webm',
			mimeType: 'video/webm',
			blob: new Blob(['video'], { type: 'video/webm' }),
			size: 5,
			duration: 1,
			frameCount: 30,
			manifest: {
				format: 'video-webm' as const,
				projectId: 'project:1',
				range: { type: 'project' as const },
				start: 0,
				duration: 1,
				fps: 30,
				frameCount: 30,
				clips: [],
				frames: [],
			},
		}))
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority, { exportRenderer: { render } })

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			const result = await harness.actions.queueProjectExport()

			expect(result).not.toBeNull()
			expect(result?.mimeType).toBe('video/webm')
			expect(result?.downloadUrl).toBe('blob:project-video-export')
			expect(render).toHaveBeenCalledWith(
				expect.objectContaining({ format: 'video-webm', range: { type: 'project' } }),
			)
			expect((render.mock.calls[0] as unknown as [ExportRenderRequest])[0]).not.toHaveProperty('fps')
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:project-video-export')
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('exports p2p resources with resolved transfer URLs without mutating domain state', async () => {
		const createElement = mockMediaElementDuration({ duration: 3 })
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (blob instanceof File) {
				return `blob:${blob.name}`
			}

			return 'blob:p2p-export'
		})
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
		const render = vi.fn(async (request: ExportRenderRequest) => ({
			id: 'export-p2p-video',
			fileName: 'project.webm',
			mimeType: 'video/webm',
			blob: new Blob(['video'], { type: 'video/webm' }),
			size: 5,
			duration: 3,
			frameCount: 90,
			manifest: {
				format: 'video-webm' as const,
				projectId: request.projectId,
				range: request.range,
				start: 0,
				duration: 3,
				fps: 30,
				frameCount: 90,
				clips: [],
				frames: [],
			},
		}))
		const authority = new MemoryWorkerAuthority() as MemoryWorkerAuthority & { role?: 'server', peerId?: string }
		authority.role = 'server'
		authority.peerId = 'peer-owner'
		const harness = createVideoEditorHarness(authority, {
			autoCreateInitialProject: false,
			exportRenderer: { render },
		})

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()

			harness.actions.importFiles([new File(['video-bytes'], 'p2p-clip.webm', { type: 'video/webm' })])
			await settleHarness()

			const registryBeforeExport = harness.projects$.get()
			const project = getActiveProject(registryBeforeExport, harness.session$.get())
			expect(project).not.toBeNull()
			const resource = getResourceEntities(registryBeforeExport, project!)[0]
			expect(resource).toBeDefined()
			const resourceId = resource.id
			expect(resource.attrs as unknown as ResourceAttrs).toMatchObject({
				url: '',
				status: 'missing',
				source: { kind: 'p2p', ownerPeerId: 'peer-owner' },
			})

			const result = await harness.actions.queueProjectExport()

			expect(result).not.toBeNull()
			expect(render).toHaveBeenCalledTimes(1)
			const exportResource = (render.mock.calls[0] as [ExportRenderRequest])[0].registry.entitiesById[resourceId]
			expect(exportResource.attrs as unknown as ResourceAttrs).toMatchObject({
				url: 'blob:p2p-clip.webm',
				status: 'ready',
				data: expect.objectContaining({
					status: 'ready',
					loadedBytes: 'video-bytes'.length,
				}),
			})
			expect(harness.projects$.get().entitiesById[resourceId].attrs as unknown as ResourceAttrs).toMatchObject({
				url: '',
				status: 'missing',
			})
		} finally {
			harness.destroy()
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:p2p-clip.webm')
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:p2p-export')
			createElement.mockRestore()
			createObjectURL.mockRestore()
			revokeObjectURL.mockRestore()
		}
	})

	it('undoes and redoes timeline edits through the harness', async () => {
		const authority = new MemoryWorkerAuthority()
		const harness = createVideoEditorHarness(authority)

		try {
			await settleHarness()
			harness.actions.createProject()
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			let registry = harness.projects$.get()
			let project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			let videoTrack = getVideoTrack(registry, project!)
			expect(videoTrack).not.toBeNull()
			expect(getClipIdsForTrack(registry, String(videoTrack?.id))).toHaveLength(1)
			expect(harness.history$.get().canUndo).toBe(true)

			harness.actions.undo()
			await settleHarness()

			registry = harness.projects$.get()
			project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			videoTrack = getVideoTrack(registry, project!)
			expect(videoTrack).not.toBeNull()
			expect(getClipIdsForTrack(registry, String(videoTrack?.id))).toHaveLength(0)
			expect(harness.history$.get()).toMatchObject({ canUndo: true, canRedo: true })

			harness.actions.redo()
			await settleHarness()

			registry = harness.projects$.get()
			project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()
			videoTrack = getVideoTrack(registry, project!)
			expect(videoTrack).not.toBeNull()
			expect(getClipIdsForTrack(registry, String(videoTrack?.id))).toHaveLength(1)
			expect(harness.history$.get()).toMatchObject({ canUndo: true, canRedo: false })
		} finally {
			harness.destroy()
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
			getHistoryState: () => ({ canUndo: false, canRedo: false }),
			subscribe: () => () => {},
			dispatch,
			undo: () => null,
			redo: () => null,
		}
		const harness = createVideoEditorHarness(authority, { autoCreateInitialProject: false })

		try {
			expect(() => harness.actions.moveClipById('clip:noop', 0)).not.toThrow()
			expect(dispatch).not.toHaveBeenCalled()
		} finally {
			harness.destroy()
		}
	})

	it('forwards project export progress updates to callback', async () => {
		const exportRenderer = {
			render: vi.fn(async (_request: ExportRenderRequest, onProgress?: (event: ExportProgressEvent) => void) => {
				onProgress?.({ stage: 'queued', progress: 0 })
				onProgress?.({ stage: 'rendering', progress: 0.5 })
				onProgress?.({ stage: 'finalizing', progress: 0.9 })
				onProgress?.({ stage: 'done', progress: 1 })

				return {
					id: 'export:test',
					fileName: 'test.webm',
					mimeType: 'video/webm',
					blob: new Blob(['test'], { type: 'video/webm' }),
					size: 4,
					duration: 1,
					frameCount: 30,
					manifest: {
						format: 'video-webm' as const,
						projectId: 'project:1',
						range: { type: 'project' as const },
						start: 0,
						duration: 1,
						fps: 30,
						frameCount: 30,
						clips: [],
						frames: [],
					},
				}
			}),
		}
		const harness = createVideoEditorHarness(new MemoryWorkerAuthority(), { exportRenderer })
		const progressEvents: ExportProgressEvent[] = []

		try {
			await settleHarness()
			await harness.actions.queueProjectExport((event) => {
				progressEvents.push(event)
			})

			expect(exportRenderer.render).toHaveBeenCalledTimes(1)
			expect(progressEvents).toEqual([
				{ stage: 'queued', progress: 0 },
				{ stage: 'rendering', progress: 0.5 },
				{ stage: 'finalizing', progress: 0.9 },
				{ stage: 'done', progress: 1 },
			])
		} finally {
			harness.destroy()
		}
	})
})
