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
import { MemoryWorkerAuthority } from '../worker/memoryWorker'

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

export const createVideoEditorHarness = () => {
	const worker = new MemoryWorkerAuthority()
	const projects$ = createProjectsStore()
	const session$ = createSessionStore()

	applySnapshot(projects$, worker.getSnapshot())

	const unsubscribe = worker.subscribe((envelope) => {
		applyPatchEnvelope(projects$, envelope)
		const activeProjectId = projects$.activeProjectId.get()
		if (activeProjectId) {
			session$.activeProjectId.set(activeProjectId)
		}
	})

	const dispatch = (command: Command): DispatchResult => worker.dispatch(command)

	const actions = {
		createProject(title?: string): string {
			const result = dispatch({ c: CMD.PROJECT_CREATE, p: { title } })
			const projectId = String(result.createdIds?.projectId)
			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
			return projectId
		},

		setActiveProject(projectId: string): void {
			projects$.activeProjectId.set(projectId)
			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
		},

		importSampleResource(): string {
			const projectId = getActiveProjectId(projects$, session$)
			const project = getActiveProject(projects$.get(), session$.get())
			const resourceOrdinal = project
				? getProjectMetaList({
						activeProjectId: project.id,
						projects: { [project.id]: project },
					})[0].resourceCount + 1
				: 1
			const kind = sampleKindCycle[(resourceOrdinal - 1) % sampleKindCycle.length]
			const result = dispatch({
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

			return String(result.createdIds?.resourceId)
		},

		addResourceToTimeline(resourceId: string): string {
			const projectId = getActiveProjectId(projects$, session$)
			const project = getActiveProject(projects$.get(), session$.get())
			if (!project) {
				throw new Error('No active project to add a clip into')
			}

			const track = getVideoTrack(project)
			if (!track) {
				throw new Error('No video track available')
			}

			const result = dispatch({
				c: CMD.TIMELINE_ADD_CLIP,
				p: { projectId, resourceId, trackId: track.id },
			})
			const clipId = String(result.createdIds?.clipId)
			session$.selectedEntityId.set(clipId)
			return clipId
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

		splitSelectedClip(): string | null {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return null
			}

			const attrs = clip.attrs as ClipAttrs
			const splitTime = attrs.start + attrs.duration / 2
			const result = dispatch({
				c: CMD.TIMELINE_SPLIT_CLIP,
				p: {
					projectId: getActiveProjectId(projects$, session$),
					clipId: clip.id,
					time: splitTime,
				},
			})
			const newClipId = String(result.createdIds?.clipId)
			session$.selectedEntityId.set(newClipId)
			return newClipId
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
		worker,
		projects$,
		session$,
		actions,
		destroy(): void {
			unsubscribe()
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
