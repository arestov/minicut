import type { Observable } from '@legendapp/state'
import { applyPatchEnvelope, applySnapshot, createProjectsStore } from '../legend/projectStore'
import { createSessionStore } from '../legend/sessionStore'
import { getActiveProject, getProjectMetaList, getSelectedClip, getVideoTrack } from '../domain/selectors'
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

const roundToTenths = (value: number): number => Math.round(value * 10) / 10

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

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

		addResourceToTimeline(resourceId: string): void {
			const projectId = getActiveProjectId(projects$, session$)
			const registry = projects$.get()
			const project = getActiveProject(registry, session$.get())
			if (!project) {
				throw new Error('No active project to add a clip into')
			}

			const track = getVideoTrack(registry, project)
			if (!track) {
				throw new Error('No video track available')
			}

			dispatch({
				c: CMD.TIMELINE_ADD_CLIP,
				p: { projectId, resourceId, trackId: track.id },
			}).then((result) => {
				const clipId = String(result.createdIds?.clipId)
				session$.selectedEntityId.set(clipId)
			})
		},

		selectEntity(entityId: string | null): void {
			session$.selectedEntityId.set(entityId)
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					projectId: getActiveProjectId(projects$, session$),
					clipId: clip.id,
					attrs: { opacity: { value: roundToTenths(opacityPercent / 100) } },
				},
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
					projectId: getActiveProjectId(projects$, session$),
					clipId: clip.id,
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

			dispatch({
				c: CMD.TIMELINE_MOVE_CLIP,
				p: {
					projectId: getActiveProjectId(projects$, session$),
					clipId: clip.id,
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
			authority.destroy?.()
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
