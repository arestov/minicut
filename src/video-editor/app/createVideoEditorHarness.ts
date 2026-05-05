import { observable, type Observable } from '@legendapp/state'
import { createPlaybackDuration$ } from '../legend/derivedTimeline'
import { applyPatchEnvelope, applySnapshot, createProjectsStore } from '../legend/projectStore'
import { createSessionStore, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from '../legend/sessionStore'
import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getProjectMetaList, getSelectedClip, getTracks, getVideoTrack } from '../domain/selectors'
import type {
	ClipAttrs,
	EffectAttrs,
	Command,
	DispatchResult,
	EditorSessionState,
	HistoryState,
	ProjectRegistry,
	ResourceAttrs,
	TextAttrs,
} from '../domain/types'
import { CMD } from '../domain/types'
import { createResourceTransferManager } from '../media/resourceTransferManager'
import type {
	ExportProgressEvent,
	ExportRenderer,
	ExportRenderResult,
} from '../render/exportRenderer'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from './platform'
import { createLegendEditorRenderRuntime } from '../render-sync/createLegendEditorRenderRuntime'
import type { EditorActionEnvironment } from './editorActionEnvironment'

const sampleKindCycle = ['video', 'audio', 'image'] as const
const SNAPSHOT_BOOTSTRAP_RETRY_MS = 250

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

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
const minimumSplitOffset = 0.01

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const getClipEnd = (attrs: ClipAttrs): number => attrs.start + attrs.duration

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs
const asResourceAttrs = (attrs: Record<string, unknown>): ResourceAttrs => attrs as unknown as ResourceAttrs

const getResizedClipAttrs = (attrs: ClipAttrs, edge: 'start' | 'end', delta: number): Pick<ClipAttrs, 'start' | 'in' | 'duration'> | Pick<ClipAttrs, 'duration'> => {
	if (edge === 'end') {
		return {
			duration: clamp(roundToTenths(attrs.duration + delta), 0.5, 120),
		}
	}

	const clipEnd = getClipEnd(attrs)
	const minStart = Math.max(0, attrs.start - attrs.in)
	const nextStart = clamp(roundToTenths(attrs.start + delta), minStart, clipEnd - 0.5)
	return {
		start: nextStart,
		in: roundToTenths(attrs.in + (nextStart - attrs.start)),
		duration: roundToTenths(clipEnd - nextStart),
	}
}

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
	platform?: VideoEditorHarnessPlatform
	mediaTransferOptions?: {
		chunkSize?: number
		chunkSendDelayMs?: number
		headBytes?: number
		tailBytes?: number
		playheadWindowSeconds?: number
	}
}

export const createVideoEditorHarness = (
	authority?: EditorAuthorityClient,
	options: CreateVideoEditorHarnessOptions = {},
) => {
	let authorityClientRef: EditorAuthorityClient | null = null
	const resourceChunkSize = options.mediaTransferOptions?.chunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	const resourceTransferManager = createResourceTransferManager({
		getRole: () => {
			const role = (authorityClientRef as Partial<{ role: unknown }> | null)?.role
			return role === 'server' || role === 'client' || role === 'undecided' ? role : null
		},
		getPeerId: () => {
			const peerId = (authorityClientRef as Partial<{ peerId: unknown }> | null)?.peerId
			return typeof peerId === 'string' ? peerId : null
		},
		chunkSize: resourceChunkSize,
		chunkSendDelayMs: options.mediaTransferOptions?.chunkSendDelayMs,
		headBytes: options.mediaTransferOptions?.headBytes,
		tailBytes: options.mediaTransferOptions?.tailBytes,
		playheadWindowSeconds: options.mediaTransferOptions?.playheadWindowSeconds,
	})
	const platform = options.platform
		?? createBrowserHarnessPlatform({
			exportRenderer: options.exportRenderer,
		})
	const authorityClient = authority ?? platform.createAuthorityClient({
		onClientResourceTransport: (transport) => {
			resourceTransferManager.attachClientTransport(transport)
		},
		onServerResourceTransport: (remotePeerId, transport) => {
			resourceTransferManager.attachServerTransport(remotePeerId, transport)
		},
		onResourcePeerDisconnected: (remotePeerId) => {
			resourceTransferManager.detachPeerTransport(remotePeerId)
		},
	})
	authorityClientRef = authorityClient
	const autoCreateInitialProject = options.autoCreateInitialProject ?? true
	const exportRenderer = options.exportRenderer ?? platform.createExportRenderer()
	const projects$ = createProjectsStore()
	const session$ = createSessionStore()
	const playbackDuration$ = createPlaybackDuration$(projects$, session$)
	const history$ = observable<HistoryState>({ canUndo: false, canRedo: false })
	const importedObjectUrls = new Set<string>()
	const exportObjectUrls = new Set<string>()
	let importFilesQueue = Promise.resolve()
	let initialBootstrapChecked = false
	let projectBootstrapInFlight = false
	let isDestroyed = false
	let snapshotBootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null
	let initialProjectRetryTimer: ReturnType<typeof setTimeout> | null = null

	const getAuthorityRole = (): 'server' | 'client' | 'undecided' | null => {
		const role = (authorityClient as Partial<{ role: unknown }>).role
		if (role === 'server' || role === 'client' || role === 'undecided') {
			return role
		}

		return null
	}

	const getAuthorityPeerId = (): string | null => {
		const peerId = (authorityClient as Partial<{ peerId: unknown }>).peerId
		return typeof peerId === 'string' ? peerId : null
	}

	const clearInitialProjectRetry = (): void => {
		if (initialProjectRetryTimer) {
			platform.clearTimeout(initialProjectRetryTimer)
			initialProjectRetryTimer = null
		}
	}

	const scheduleInitialProjectRetry = (): void => {
		if (isDestroyed || initialProjectRetryTimer) {
			return
		}

		initialProjectRetryTimer = platform.setTimeout(() => {
			initialProjectRetryTimer = null
			ensureInitialProject()
		}, SNAPSHOT_BOOTSTRAP_RETRY_MS)
	}

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

	const syncHistoryState = (): void => {
		Promise.resolve(authorityClient.getHistoryState()).then((state) => {
			if (!isDestroyed) {
				history$.set(state)
			}
		})
	}

	const ensureInitialProject = (): void => {
		if (!autoCreateInitialProject) {
			return
		}
		if (initialBootstrapChecked || isDestroyed) {
			return
		}

		const authorityRole = getAuthorityRole()
		if (authorityRole === 'client') {
			initialBootstrapChecked = true
			clearInitialProjectRetry()
			return
		}

		if (authorityRole === 'undecided') {
			scheduleInitialProjectRetry()
			return
		}

		initialBootstrapChecked = true
		clearInitialProjectRetry()

		const registry = projects$.get()
		if (Object.keys(registry.projects).length > 0 || projectBootstrapInFlight) {
			syncActiveProjectSelection()
			return
		}

		projectBootstrapInFlight = true
		Promise.resolve(authorityClient.dispatch({ c: CMD.PROJECT_CREATE, p: {} })).then((result) => {
			if (isDestroyed) {
				return
			}

			const projectId = String(result.createdIds?.projectId)
			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
		}).finally(() => {
			projectBootstrapInFlight = false
			syncHistoryState()
		})
	}

	const bootstrapSnapshot = (): void => {
		Promise.resolve(authorityClient.getSnapshot()).then((snapshot) => {
			if (isDestroyed) {
				return
			}

			if (snapshotBootstrapRetryTimer) {
				platform.clearTimeout(snapshotBootstrapRetryTimer)
				snapshotBootstrapRetryTimer = null
			}

			applySnapshot(projects$, snapshot)
			resourceTransferManager.syncRegistry(snapshot)
			syncActiveProjectSelection()
			syncHistoryState()
			ensureInitialProject()
		}).catch(() => {
			if (isDestroyed) {
				return
			}

			snapshotBootstrapRetryTimer = platform.setTimeout(() => {
				snapshotBootstrapRetryTimer = null
				bootstrapSnapshot()
			}, SNAPSHOT_BOOTSTRAP_RETRY_MS)
		})
	}

	bootstrapSnapshot()

	const unsubscribe = authorityClient.subscribe((envelope) => {
		applyPatchEnvelope(projects$, envelope)
		resourceTransferManager.syncRegistry(projects$.get())
		syncActiveProjectSelection()
		syncHistoryState()
	})

	const dispatch = (command: Command): Promise<DispatchResult> =>
		Promise.resolve(authorityClient.dispatch(command)).finally(syncHistoryState)

	const actionEnvironment: EditorActionEnvironment = {
		stores: {
			projects$,
			history$,
			getRegistry: () => projects$.get(),
			applySnapshot: (snapshot) => applySnapshot(projects$, snapshot),
			applyPatchEnvelope: (envelope) => applyPatchEnvelope(projects$, envelope),
		},
		authority: {
			client: authorityClient,
			dispatch,
			undo: () => authorityClient.undo(),
			redo: () => authorityClient.redo(),
			getSnapshot: () => authorityClient.getSnapshot(),
			getHistoryState: () => authorityClient.getHistoryState(),
			subscribe: (listener) => authorityClient.subscribe(listener),
		},
		session: {
			session$,
			get: () => session$.get(),
			setActiveProject: (projectId) => session$.activeProjectId.set(projectId),
			selectEntity: (entityId) => session$.selectedEntityId.set(entityId),
			setCursor: (value) => session$.cursor.set(value),
			setPlaying: (value) => session$.isPlaying.set(value),
			setTimelineZoom: (value) => session$.timelineZoom.set(value),
			setActiveInspectorTab: (tab) => session$.activeInspectorTab.set(tab),
		},
		media: {
			getFileKind,
			createObjectUrl: (blob) => platform.createObjectUrl(blob),
			revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
			getImportedResourceDuration: (url, kind) => platform.getImportedResourceDuration(url, kind),
		},
		export: {
			renderer: exportRenderer,
			render: (request, onProgress) => exportRenderer.render(request, onProgress),
		},
		transfers: {
			manager: resourceTransferManager,
			syncRegistry: (registry) => resourceTransferManager.syncRegistry(registry),
			resolveResourceUrl: (resourceId, fallbackUrl) => resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl),
			requestPlayheadWindow: (resourceId, time) => resourceTransferManager.requestPlayheadWindow(resourceId, time),
			notePreviewError: (resourceId) => resourceTransferManager.notePreviewError(resourceId),
		},
		lifecycle: {
			isDestroyed: () => isDestroyed,
			setTimeout: (handler, timeoutMs) => platform.setTimeout(handler, timeoutMs),
			clearTimeout: (timerId) => platform.clearTimeout(timerId),
			registerObjectUrl: (url, bucket) => {
				if (bucket === 'import') {
					importedObjectUrls.add(url)
					return
				}

				exportObjectUrls.add(url)
			},
		},
		platform,
	}

	const createExportRegistrySnapshot = (registry: ProjectRegistry): ProjectRegistry => {
		const snapshot = structuredClone(registry)
		for (const [resourceId, entity] of Object.entries(snapshot.entitiesById)) {
			if (!entity || entity.type !== 'resource') {
				continue
			}

			const attrs = asResourceAttrs(entity.attrs)
			const transfer = resourceTransferManager.getTransfer(resourceId)
			if (!transfer || transfer.status !== 'ready') {
				continue
			}

			const resolvedUrl = resourceTransferManager.resolveResourceUrl(resourceId, attrs.url)
			if (!resolvedUrl) {
				continue
			}

			entity.attrs = {
				...attrs,
				url: resolvedUrl,
				status: 'ready',
				data: {
					...attrs.data,
					status: 'ready',
					loadedBytes: transfer.loadedBytes,
					ranges: {
						...attrs.data.ranges,
						loaded: transfer.loadedRanges,
						requested: transfer.requestedRanges,
					},
				},
			}
		}

		return snapshot
	}

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

		undo(): void {
			Promise.resolve(authorityClient.undo()).finally(syncHistoryState)
		},

		redo(): void {
			Promise.resolve(authorityClient.redo()).finally(syncHistoryState)
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

				const url = platform.createObjectUrl(file)
				if (!url) {
					continue
				}
				importedObjectUrls.add(url)
				importFilesQueue = importFilesQueue.then(async () => {
					const duration = await platform.getImportedResourceDuration(url, kind)
					if (isDestroyed) {
						return
					}

					const ownerPeerId = getAuthorityPeerId()
					const source = ownerPeerId
						? { kind: 'p2p' as const, ownerPeerId }
						: { kind: 'local' as const }

					dispatch({
						c: CMD.RESOURCE_IMPORT,
						p: {
							projectId,
							name: file.name,
							kind,
							duration,
							mime: file.type || `${kind}/unknown`,
							url: source.kind === 'p2p' ? '' : url,
							width: kind === 'audio' ? undefined : 1920,
							height: kind === 'audio' ? undefined : 1080,
							size: file.size,
							source,
							dataStatus: source.kind === 'p2p' ? 'missing' : 'ready',
							chunkSize: resourceChunkSize,
						},
					}).then((result) => {
						const resourceId = result.createdIds?.resourceId
						if (resourceId) {
							resourceTransferManager.registerLocalResource(String(resourceId), file, {
								objectUrl: url,
								kind,
								mime: file.type || `${kind}/unknown`,
								duration,
								size: file.size,
								chunkSize: resourceChunkSize,
								ownerPeerId,
								sourceKind: source.kind,
								fallbackUrl: source.kind === 'p2p' ? '' : url,
								name: file.name,
							})
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
				p: { projectId, resourceId, trackId: track.id, includeLinkedAudio: resource?.attrs.kind === 'video' },
			}).then((result) => {
				const clipId = String(result.createdIds?.clipId)
				session$.selectedEntityId.set(clipId)
			})
		},

		addTextClip(content = 'Title'): void {
			const projectId = getActiveProjectId(projects$, session$)
			dispatch({
				c: CMD.TEXT_ADD,
				p: { projectId, content },
			}).then((result) => {
				const clipId = result.createdIds?.clipId
				if (clipId) {
					session$.selectedEntityId.set(String(clipId))
				}
			})
		},

		updateSelectedText(attrs: Partial<TextAttrs>): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			const textId = clip?.rels.text
			if (typeof textId !== 'string') {
				return
			}

			dispatch({
				c: CMD.TEXT_UPDATE_ATTRS,
				p: { id: textId, attrs },
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

		setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void {
			session$.activeInspectorTab.set(tab)
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

		updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const key = edge === 'in' ? 'fadeIn' : 'fadeOut'
			const current = Number(attrs[key] ?? 0)
			const nextFade = clamp(roundToTenths(current + delta), 0, attrs.duration)
			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: { [key]: nextFade },
				},
			})
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
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

		updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: {
						audio: {
							gain: partial.gain ?? attrs.audio?.gain ?? 1,
							pan: partial.pan ?? attrs.audio?.pan ?? 0,
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

			const attrs = asClipAttrs(clip.attrs)
			const nextAttrs = getResizedClipAttrs(attrs, edge, delta)

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clip.id,
					attrs: nextAttrs,
				},
			})
		},

		resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			if (delta === 0) {
				return
			}

			const clip = projects$.get().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			dispatch({
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: clipId,
					attrs: getResizedClipAttrs(asClipAttrs(clip.attrs), edge, delta),
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

		addColorCorrectionToSelectedClip(): void {
			const clip = getSelectedClip(projects$.get(), session$.get())
			if (!clip) {
				return
			}

			dispatch({
				c: CMD.EFFECT_ADD,
				p: {
					id: clip.id,
					name: 'Primary Correction',
					kind: 'color-correction',
				},
			})
		},

		updateEffectAttrs(effectId: string, attrs: Partial<EffectAttrs>): void {
			dispatch({
				c: CMD.EFFECT_UPDATE_ATTRS,
				p: { id: effectId, attrs },
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

			const attrs = asClipAttrs(clip.attrs)
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

		splitClipByIdAt(clipId: string, time: number): void {
			const clip = projects$.get().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const splitTime = clamp(roundToHundredths(time), attrs.start + minimumSplitOffset, attrs.start + attrs.duration - minimumSplitOffset)
			dispatch({
				c: CMD.TIMELINE_SPLIT_CLIP,
				p: { id: clipId, time: splitTime },
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

		async queueSelectedClipExport(
			onProgress?: (event: ExportProgressEvent) => void,
		): Promise<ExportRenderResult | null> {
			const registry = projects$.get()
			const session = session$.get()
			const project = getActiveProject(registry, session)
			const clip = getSelectedClip(registry, session)
			if (!project || !clip) {
				return null
			}

			const request = {
				registry: createExportRegistrySnapshot(registry),
				projectId: project.id,
				range: { type: 'clip' as const, clipId: clip.id },
				format: 'video-webm' as const,
			}
			const result = onProgress
				? await exportRenderer.render(request, onProgress)
				: await exportRenderer.render(request)
			const downloadUrl = platform.createObjectUrl(result.blob)
			if (downloadUrl) {
				exportObjectUrls.add(downloadUrl)
				return { ...result, downloadUrl }
			}

			return result
		},

		async queueProjectExport(
			onProgress?: (event: ExportProgressEvent) => void,
		): Promise<ExportRenderResult | null> {
			const registry = projects$.get()
			const project = getActiveProject(registry, session$.get())
			if (!project) {
				return null
			}

			const request = {
				registry: createExportRegistrySnapshot(registry),
				projectId: project.id,
				range: { type: 'project' as const },
				format: 'video-webm' as const,
			}
			const result = onProgress
				? await exportRenderer.render(request, onProgress)
				: await exportRenderer.render(request)
			const downloadUrl = platform.createObjectUrl(result.blob)
			if (downloadUrl) {
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

			const playbackDuration = playbackDuration$.get()
			session$.cursor.set((session$.cursor.get() + deltaSeconds) % playbackDuration)
		},

		zoomTimeline(delta: number): void {
			session$.timelineZoom.set(clamp(session$.timelineZoom.get() + delta, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX))
		},
	}
	const renderRuntime = createLegendEditorRenderRuntime({
		projects$,
		session$,
		history$,
		resourceTransfers$: resourceTransferManager.transfers$,
		actions,
	})

	return {
		worker: authorityClient,
		projects$,
		session$,
		history$,
		renderRuntime,
		resourceTransfers$: resourceTransferManager.transfers$,
		actionEnvironment,
		resolveResourceUrl(resourceId: string, fallbackUrl: string): string {
			return resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl)
		},
		requestResourcePlayheadWindow(resourceId: string, time: number): void {
			resourceTransferManager.requestPlayheadWindow(resourceId, time)
		},
		noteResourcePreviewError(resourceId: string): void {
			resourceTransferManager.notePreviewError(resourceId)
		},
		actions,
		destroy(): void {
			isDestroyed = true
			clearInitialProjectRetry()
			if (snapshotBootstrapRetryTimer) {
				platform.clearTimeout(snapshotBootstrapRetryTimer)
				snapshotBootstrapRetryTimer = null
			}
			unsubscribe()
			for (const url of importedObjectUrls) {
				platform.revokeObjectUrl(url)
			}
			resourceTransferManager.destroy()
			authorityClient.destroy?.()
			for (const url of exportObjectUrls) {
				platform.revokeObjectUrl(url)
			}
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
