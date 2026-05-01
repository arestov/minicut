import type { Observable } from '@legendapp/state'
import { applyPatchEnvelope, applySnapshot, createProjectsStore } from '../legend/projectStore'
import { createSessionStore } from '../legend/sessionStore'
import { getActiveProject, getAudioTrack, getProjectMetaList, getSelectedClip, getVideoTrack } from '../domain/selectors'
import type {
	ClipAttrs,
	Command,
	DispatchResult,
	EditorSessionState,
	ProjectRegistry,
} from '../domain/types'
import { CMD } from '../domain/types'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createAuthorityClient } from '../worker/createAuthorityClient'

const sampleKindCycle = ['video', 'audio', 'image'] as const

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
	return null
}

const roundToTenths = (value: number): number => Math.round(value * 10) / 10

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const getClipEnd = (attrs: ClipAttrs): number => attrs.start + attrs.duration

const getActiveProjectId = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): string => {
	const projectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	if (!projectId) {
		throw new Error('No active project selected')
	}

	return projectId
}

export const createVideoEditorHarness = (authority: EditorAuthorityClient = createAuthorityClient()) => {
	const projects$ = createProjectsStore()
	const session$ = createSessionStore()
	const importedObjectUrls = new Set<string>()
	let isDestroyed = false

	Promise.resolve(authority.getSnapshot()).then((snapshot) => {
		if (isDestroyed) {
			return
		}

		applySnapshot(projects$, snapshot)
	})

	const unsubscribe = authority.subscribe((envelope) => {
		applyPatchEnvelope(projects$, envelope)
	})

	const dispatch = (command: Command): Promise<DispatchResult> =>
		Promise.resolve(authority.dispatch(command))

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
				dispatch({
					c: CMD.RESOURCE_IMPORT,
					p: {
						projectId,
						name: file.name,
						kind,
						duration: kind === 'image' ? 5 : 6,
						mime: file.type || `${kind}/unknown`,
						url,
						width: kind === 'audio' ? undefined : 1920,
						height: kind === 'audio' ? undefined : 1080,
					},
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
			const splitTime = attrs.start + attrs.duration / 2
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

		nudgeSelectedClip(delta: number): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			actions.moveClipById(clip.id, delta)
		},

		moveClipById(clipId: string, delta: number): void {

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
			session$.cursor.set(roundToTenths(value))
		},

		tickPlayback(deltaSeconds: number): void {
			if (!session$.isPlaying.get()) {
				return
			}

			session$.cursor.set(roundToTenths((session$.cursor.get() + deltaSeconds) % 20))
		},

		zoomTimeline(delta: number): void {
			session$.timelineZoom.set(clamp(session$.timelineZoom.get() + delta, 32, 112))
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
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
