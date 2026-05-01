import type { Observable } from '@legendapp/state'
import { applyPatchEnvelope, applySnapshot, createProjectsStore } from '../legend/projectStore'
import { createSessionStore, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from '../legend/sessionStore'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getProjectMetaList, getSelectedClip, getTracks, getVideoTrack } from '../domain/selectors'
import type {
	ClipAttrs,
	Command,
	DispatchResult,
	EditorSessionState,
	ProjectRegistry,
} from '../domain/types'
import { CMD } from '../domain/types'
import { createManifestExportRenderer, type ExportRenderer, type ExportRenderResult } from '../render/exportRenderer'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createAuthorityClient } from '../worker/createAuthorityClient'

const sampleKindCycle = ['video', 'audio', 'image'] as const
const fallbackMediaDuration = 6
const imageDuration = 1

const getFileKind = (file: File): 'video' | 'audio' | 'image' | null => {
	if (file.type.startsWith('video/')) {
		return 'video'
	}
	if (file.type.startsWith('audio/')) {
		return 'audio'
	}
	if (file.type.startsWith('image/')) {
		return 'image'
	}

	const lowerName = file.name.toLowerCase()
	if (/\.(mp4|webm|mov|mkv)$/.test(lowerName)) {
		return 'video'
	}
	if (/\.(wav|mp3|ogg|m4a|aac)$/.test(lowerName)) {
		return 'audio'
	}
	if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lowerName)) {
		return 'image'
	}

	return null
}

const getMediaDuration = (
	url: string,
	kind: 'video' | 'audio',
	fallbackDuration = fallbackMediaDuration,
): Promise<number> => new Promise((resolve) => {
	const element = document.createElement(kind)
	let settled = false
	const timeoutId = window.setTimeout(() => finish(fallbackDuration), 3000)

	const finish = (duration: number): void => {
		if (settled) {
			return
		}

		settled = true
		window.clearTimeout(timeoutId)
		element.removeAttribute('src')
		element.load()
		resolve(Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration)
	}

	element.preload = 'metadata'
	element.onloadedmetadata = () => finish(element.duration)
	element.onerror = () => finish(fallbackDuration)
	element.src = url
	element.load()
})

const getImportedResourceDuration = async (
	url: string,
	kind: 'video' | 'audio' | 'image',
): Promise<number> => {
	if (kind === 'image') {
		return imageDuration
	}

	return getMediaDuration(url, kind)
}

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
const minimumSplitOffset = 0.01

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const getClipEnd = (attrs: ClipAttrs): number => attrs.start + attrs.duration

const resolveActiveProjectId = (
	registry: ProjectRegistry,
	session: Pick<EditorSessionState, 'activeProjectId'>,
): string | null => {
	// Contract: session.activeProjectId is the tab-local source of truth when valid.
	const sessionProjectId = session.activeProjectId
	if (sessionProjectId && registry.projects[sessionProjectId]) {
		return sessionProjectId
	}

	// registry.activeProjectId remains a cross-tab hint and fallback.
	const registryProjectId = registry.activeProjectId
	if (registryProjectId && registry.projects[registryProjectId]) {
		return registryProjectId
	}

	return Object.keys(registry.projects)[0] ?? null
}

const getActiveProjectId = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): string => {
	const projectId = resolveActiveProjectId(projects$.get(), session$.get())
	if (!projectId) {
		throw new Error('No active project selected')
	}

	return projectId
}

const getPlaybackDuration = (registry: ProjectRegistry, session: EditorSessionState): number => {
	const project = getActiveProject(registry, session)
	if (!project) {
		return 20
	}

	const projectAttrs = registry.entitiesById[project.rootEntityId]?.attrs as { duration?: number } | undefined
	const declaredProjectDuration = Number(projectAttrs?.duration)
	if (Number.isFinite(declaredProjectDuration) && declaredProjectDuration > 0) {
		return declaredProjectDuration
	}

	const timelineId = registry.entitiesById[project.rootEntityId]?.rels.activeTimeline
	const timeline = typeof timelineId === 'string' ? registry.entitiesById[timelineId] : undefined
	const declaredTimelineDuration = Number((timeline?.attrs as { duration?: number } | undefined)?.duration)
	if (Number.isFinite(declaredTimelineDuration) && declaredTimelineDuration > 0) {
		return declaredTimelineDuration
	}

	const trackIds = timeline?.rels.tracks
	if (!Array.isArray(trackIds)) {
		return 20
	}

	let clipEnd = 0
	for (const trackId of trackIds) {
		const clipIds = registry.entitiesById[trackId]?.rels.clips
		if (!Array.isArray(clipIds)) {
			continue
		}

		for (const clipId of clipIds) {
			const attrs = registry.entitiesById[clipId]?.attrs as Partial<ClipAttrs> | undefined
			const start = Number(attrs?.start)
			const duration = Number(attrs?.duration)
			if (Number.isFinite(start) && Number.isFinite(duration)) {
				clipEnd = Math.max(clipEnd, start + duration)
			}
		}
	}

	return clipEnd > 0 ? clipEnd : 20
}

const isProjectTimelineEmpty = (registry: ProjectRegistry, projectId: string): boolean => {
	const project = registry.projects[projectId]
	if (!project) {
		return false
	}

	return getTracks(registry, project).every((track) => getClipIdsForTrack(registry, track.id).length === 0)
}

interface CreateVideoEditorHarnessOptions {
	autoCreateInitialProject?: boolean
	exportRenderer?: ExportRenderer
}

export const createVideoEditorHarness = (
	authority: EditorAuthorityClient = createAuthorityClient(),
	options: CreateVideoEditorHarnessOptions = {},
) => {
	const autoCreateInitialProject = options.autoCreateInitialProject ?? true
	const exportRenderer = options.exportRenderer ?? createManifestExportRenderer()
	const projects$ = createProjectsStore()
	const session$ = createSessionStore()
	const importedObjectUrls = new Set<string>()
	const exportObjectUrls = new Set<string>()
	let importFilesQueue = Promise.resolve()
	let initialBootstrapChecked = false
	let projectBootstrapInFlight = false
	let isDestroyed = false

	const syncActiveProjectSelection = (): void => {
		const registry = projects$.get()
		const resolvedProjectId = resolveActiveProjectId(registry, session$.get())
		if (!resolvedProjectId) {
			return
		}

		const registryActiveProjectId = projects$.activeProjectId.get()
		if (!registryActiveProjectId || !registry.projects[registryActiveProjectId]) {
			projects$.activeProjectId.set(resolvedProjectId)
		}

		if (session$.activeProjectId.get() !== resolvedProjectId) {
			session$.activeProjectId.set(resolvedProjectId)
		}
	}

	const ensureInitialProject = (): void => {
		if (!autoCreateInitialProject) {
			return
		}
		if (initialBootstrapChecked || isDestroyed) {
			return
		}
		initialBootstrapChecked = true

		const registry = projects$.get()
		if (Object.keys(registry.projects).length > 0 || projectBootstrapInFlight) {
			syncActiveProjectSelection()
			return
		}

		projectBootstrapInFlight = true
		Promise.resolve(authority.dispatch({ c: CMD.PROJECT_CREATE, p: {} })).then((result) => {
			if (isDestroyed) {
				return
			}

			const projectId = String(result.createdIds?.projectId)
			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
		}).finally(() => {
			projectBootstrapInFlight = false
		})
	}

	Promise.resolve(authority.getSnapshot()).then((snapshot) => {
		if (isDestroyed) {
			return
		}

		applySnapshot(projects$, snapshot)
		syncActiveProjectSelection()
		ensureInitialProject()
	})

	const unsubscribe = authority.subscribe((envelope) => {
		applyPatchEnvelope(projects$, envelope)
		syncActiveProjectSelection()
	})

	const dispatch = (command: Command): Promise<DispatchResult> =>
		Promise.resolve(authority.dispatch(command))

	const addResourceToTimelineIfEmpty = (projectId: string, resourceId: string): void => {
		if (isDestroyed || !isProjectTimelineEmpty(projects$.get(), projectId)) {
			return
		}

		actions.addResourceToTimeline(resourceId)
	}

	const actions = {
		createProject(title?: string): void {
			dispatch({ c: CMD.PROJECT_CREATE, p: { title } }).then((result) => {
				const projectId = String(result.createdIds?.projectId)
				session$.activeProjectId.set(projectId)
				session$.selectedEntityId.set(null)
				session$.cursor.set(0)
			})
		},

		setActiveProject(projectId: string): void {
			projects$.activeProjectId.set(projectId)
			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
		},

		importSampleResource(): void {
			const projectId = getActiveProjectId(projects$, session$)
			const registry = projects$.get()
			const project = getActiveProject(registry, session$.get())
			const resourceOrdinal = project
				? (getProjectMetaList(registry).find((meta) => meta.id === project.id)?.resourceCount ?? 0) + 1
				: 1
			const kind = sampleKindCycle[(resourceOrdinal - 1) % sampleKindCycle.length]
			dispatch({
				c: CMD.RESOURCE_IMPORT,
				p: {
					projectId,
					name: `Sample asset ${resourceOrdinal}`,
					kind,
					duration: 4 + resourceOrdinal,
					mime: `${kind}/sample`,
					url: `sample://asset-${resourceOrdinal}`,
					width: kind === 'audio' ? undefined : 1920,
					height: kind === 'audio' ? undefined : 1080,
				},
			}).then((result) => {
				const resourceId = result.createdIds?.resourceId
				if (resourceId) {
					addResourceToTimelineIfEmpty(projectId, String(resourceId))
				}
			})
		},

		importFiles(files: FileList | File[]): void {
			const projectId = getActiveProjectId(projects$, session$)
			for (const file of Array.from(files)) {
				const kind = getFileKind(file)
				if (!kind) {
					continue
				}

				const url = URL.createObjectURL(file)
				importedObjectUrls.add(url)
				importFilesQueue = importFilesQueue.then(async () => {
					const duration = await getImportedResourceDuration(url, kind)
					if (isDestroyed) {
						return
					}

					dispatch({
						c: CMD.RESOURCE_IMPORT,
						p: {
							projectId,
							name: file.name,
							kind,
							duration,
							mime: file.type || `${kind}/unknown`,
							url,
							width: kind === 'audio' ? undefined : 1920,
							height: kind === 'audio' ? undefined : 1080,
						},
					}).then((result) => {
						const resourceId = result.createdIds?.resourceId
						if (resourceId) {
							addResourceToTimelineIfEmpty(projectId, String(resourceId))
						}
					})
				})
			}
		},

		addResourceToTimeline(resourceId: string): void {
			const projectId = getActiveProjectId(projects$, session$)
			const registry = projects$.get()
			const project = getActiveProject(registry, session$.get())
			if (!project) {
				throw new Error('No active project to add a clip into')
			}

			const resource = registry.entitiesById[resourceId]
			const track = resource?.attrs.kind === 'audio'
				? getAudioTrack(registry, project)
				: getVideoTrack(registry, project)
			if (!track) {
				throw new Error('No compatible track available')
			}

			dispatch({
				c: CMD.TIMELINE_ADD_CLIP,
				p: { projectId, resourceId, trackId: track.id },
			}).then((result) => {
				const clipId = String(result.createdIds?.clipId)
				session$.selectedEntityId.set(clipId)
			})
		},

		addTrack(kind: 'video' | 'audio'): void {
			const projectId = getActiveProjectId(projects$, session$)
			dispatch({
				c: CMD.TRACK_CREATE,
				p: { projectId, kind },
			})
		},

		selectEntity(entityId: string | null): void {
			session$.selectedEntityId.set(entityId)
		},

		renameSelectedClip(name: string): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: { name },
				},
			})
		},

		colorSelectedClip(color: string): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: { color },
				},
			})
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: { opacity: { value: roundToTenths(opacityPercent / 100) } },
				},
			})
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			const attrs = clip.attrs as ClipAttrs
			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: {
						transform: {
							x: { value: partial.x ?? attrs.transform.x.value },
							y: { value: partial.y ?? attrs.transform.y.value },
							scale: { value: partial.scale ?? attrs.transform.scale.value },
							rotation: { value: partial.rotation ?? attrs.transform.rotation.value },
						},
					},
				},
			})
		},

		trimSelectedClip(edge: 'start' | 'end', delta: number): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			const attrs = clip.attrs as ClipAttrs
			const clipEnd = getClipEnd(attrs)
			const nextAttrs = edge === 'start'
				? (() => {
						const nextStart = clamp(roundToTenths(attrs.start + delta), 0, clipEnd - 0.5)
						return {
							start: nextStart,
							in: roundToTenths(attrs.in + (nextStart - attrs.start)),
							duration: roundToTenths(clipEnd - nextStart),
						}
					})()
				: {
						duration: clamp(roundToTenths(attrs.duration + delta), 0.5, 120),
					}

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: nextAttrs,
				},
			})
		},

		addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.EFFECT_ADD,
				p: {
					id: clip.id,
					name: `${kind[0].toUpperCase()}${kind.slice(1)}`,
					kind,
					amount: kind === 'tint' ? 0.35 : 0.25,
				},
			})
		},

		deleteSelectedClip(): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.TIMELINE_DELETE_CLIP,
				p: {
					id: clip.id,
				},
			}).then(() => {
				session$.selectedEntityId.set(null)
			})
		},

		splitSelectedClip(): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			const attrs = clip.attrs as ClipAttrs
			const clipEnd = attrs.start + attrs.duration
			const splitTime = clamp(
				roundToHundredths(session$.cursor.get()),
				attrs.start + minimumSplitOffset,
				clipEnd - minimumSplitOffset,
			)
			dispatch({
				c: CMD.TIMELINE_SPLIT_CLIP,
				p: {
					id: clip.id,
					time: splitTime,
				},
			}).then((result) => {
				const newClipId = String(result.createdIds?.clipId)
				session$.selectedEntityId.set(newClipId)
			})
		},

		removeEffectFromSelectedClip(effectId: string): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.EFFECT_REMOVE,
				p: {
					id: clip.id,
					effectId,
				},
			})
		},

		async queueSelectedClipExport(): Promise<ExportRenderResult | null> {
			const registry = projects$.get()
			const session = session$.get()
			const project = getActiveProject(registry, session)
			const clip = getSelectedClip(registry, session)
			if (!project || !clip) {
				return null
			}

			const result = await exportRenderer.render({
				registry,
				projectId: project.id,
				range: { type: 'clip', clipId: clip.id },
				format: 'json-manifest',
				fps: 30,
			})
			if (typeof URL.createObjectURL === 'function') {
				const downloadUrl = URL.createObjectURL(result.blob)
				exportObjectUrls.add(downloadUrl)
				return { ...result, downloadUrl }
			}

			return result
		},

		nudgeSelectedClip(delta: number): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			actions.moveClipById(clip.id, delta)
		},

		moveClipById(clipId: string, delta: number): void {
			if (delta === 0) {
				return
			}

			dispatch({
				c: CMD.TIMELINE_MOVE_CLIP,
				p: {
					id: clipId,
					delta,
				},
			})
		},

		togglePlayback(): void {
			session$.isPlaying.set(!session$.isPlaying.get())
		},

		setCursor(value: number): void {
			session$.cursor.set(roundToHundredths(value))
		},

		tickPlayback(deltaSeconds: number): void {
			if (!session$.isPlaying.get()) {
				return
			}

			const playbackDuration = getPlaybackDuration(projects$.get(), session$.get())
			session$.cursor.set((session$.cursor.get() + deltaSeconds) % playbackDuration)
		},

		zoomTimeline(delta: number): void {
			session$.timelineZoom.set(clamp(session$.timelineZoom.get() + delta, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX))
		},
	}

	return {
		worker: authority,
		projects$,
		session$,
		actions,
		destroy(): void {
			isDestroyed = true
			unsubscribe()
			for (const url of importedObjectUrls) {
				URL.revokeObjectURL(url)
			}
			authority.destroy?.()
			for (const url of exportObjectUrls) {
				URL.revokeObjectURL(url)
			}
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
