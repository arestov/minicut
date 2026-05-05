import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getProjectMetaList, getSelectedClip, getTracks, getVideoTrack } from '../domain/selectors'
import type { ClipAttrs, EditorSessionState, ProjectRegistry, ResourceAttrs, TextAttrs } from '../domain/types'
import { CMD } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { ClipResizeAttrs, CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'

const sampleKindCycle = ['video', 'audio', 'image'] as const
const minimumSplitOffset = 0.01

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const getClipEnd = (attrs: ClipAttrs): number => attrs.start + attrs.duration

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs
const asResourceAttrs = (attrs: Record<string, unknown>): ResourceAttrs => attrs as unknown as ResourceAttrs

const getActiveProjectId = (env: EditorActionEnvironment): string => {
	const registry = env.stores.getRegistry()
	const session = env.session.get()
	const sessionProjectId = session.activeProjectId
	if (sessionProjectId && registry.projects[sessionProjectId]) {
		return sessionProjectId
	}

	const registryProjectId = registry.activeProjectId
	if (registryProjectId && registry.projects[registryProjectId]) {
		return registryProjectId
	}

	const projectId = Object.keys(registry.projects)[0]
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

const getResizedClipAttrs = (attrs: ClipAttrs, edge: 'start' | 'end', delta: number): ClipResizeAttrs => {
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

const createExportRegistrySnapshot = (env: EditorActionEnvironment, registry: ProjectRegistry): ProjectRegistry => {
	const snapshot = structuredClone(registry)
	for (const [resourceId, entity] of Object.entries(snapshot.entitiesById)) {
		if (!entity || entity.type !== 'resource') {
			continue
		}

		const attrs = asResourceAttrs(entity.attrs)
		const transfer = env.transfers.manager.getTransfer(resourceId)
		if (!transfer || transfer.status !== 'ready') {
			continue
		}

		const resolvedUrl = env.transfers.resolveResourceUrl(resourceId, attrs.url)
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

export const createLegendActionRuntime = (
	env: EditorActionEnvironment,
	options: CreateLegendActionRuntimeOptions,
): VideoEditorHarnessActions => {
	const resourceChunkSize = options.resourceChunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	let importFilesQueue = Promise.resolve()

	const addResourceToTimelineIfEmpty = (projectId: string, resourceId: string): void => {
		if (env.lifecycle.isDestroyed() || !isProjectTimelineEmpty(env.stores.getRegistry(), projectId)) {
			return
		}

		actions.addResourceToTimeline(resourceId)
	}

	const getAuthorityPeerId = (): string | null => {
		const peerId = (env.authority.client as Partial<{ peerId: unknown }>).peerId
		return typeof peerId === 'string' ? peerId : null
	}

	const actions: VideoEditorHarnessActions = {
		createProject(title?: string): void {
			env.authority.dispatch({ c: CMD.PROJECT_CREATE, p: { title } }).then((result) => {
				const projectId = String(result.createdIds?.projectId)
				env.session.setActiveProject(projectId)
				env.session.selectEntity(null)
				env.session.setCursor(0)
			})
		},

		setActiveProject(projectId: string): void {
			env.stores.projects$.activeProjectId.set(projectId)
			env.session.setActiveProject(projectId)
			env.session.selectEntity(null)
			env.session.setCursor(0)
		},

		undo(): void {
			Promise.resolve(env.authority.undo()).finally(env.authority.syncHistoryState)
		},

		redo(): void {
			Promise.resolve(env.authority.redo()).finally(env.authority.syncHistoryState)
		},

		importSampleResource(): void {
			const projectId = getActiveProjectId(env)
			const registry = env.stores.getRegistry()
			const project = getActiveProject(registry, env.session.get())
			const resourceOrdinal = project
				? (getProjectMetaList(registry).find((meta) => meta.id === project.id)?.resourceCount ?? 0) + 1
				: 1
			const kind = sampleKindCycle[(resourceOrdinal - 1) % sampleKindCycle.length]
			env.authority.dispatch({
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
			const projectId = getActiveProjectId(env)
			for (const file of Array.from(files)) {
				const kind = env.media.getFileKind(file)
				if (!kind) {
					continue
				}

				const url = env.media.createObjectUrl(file)
				if (!url) {
					continue
				}
				env.lifecycle.registerObjectUrl(url, 'import')
				importFilesQueue = importFilesQueue.then(async () => {
					const duration = await env.media.getImportedResourceDuration(url, kind)
					if (env.lifecycle.isDestroyed()) {
						return
					}

					const ownerPeerId = getAuthorityPeerId()
					const source = ownerPeerId
						? { kind: 'p2p' as const, ownerPeerId }
						: { kind: 'local' as const }

					env.authority.dispatch({
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
							env.transfers.manager.registerLocalResource(String(resourceId), file, {
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
			const projectId = getActiveProjectId(env)
			const registry = env.stores.getRegistry()
			const project = getActiveProject(registry, env.session.get())
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

			env.authority.dispatch({
				c: CMD.TIMELINE_ADD_CLIP,
				p: { projectId, resourceId, trackId: track.id, includeLinkedAudio: resource?.attrs.kind === 'video' },
			}).then((result) => {
				const clipId = String(result.createdIds?.clipId)
				env.session.selectEntity(clipId)
			})
		},

		addTextClip(content = 'Title'): void {
			const projectId = getActiveProjectId(env)
			env.authority.dispatch({
				c: CMD.TEXT_ADD,
				p: { projectId, content },
			}).then((result) => {
				const clipId = result.createdIds?.clipId
				if (clipId) {
					env.session.selectEntity(String(clipId))
				}
			})
		},

		updateSelectedText(attrs: Partial<TextAttrs>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			const textId = clip?.rels.text
			if (typeof textId !== 'string') {
				return
			}

			env.authority.dispatch({
				c: CMD.TEXT_UPDATE_ATTRS,
				p: { id: textId, attrs },
			})
		},

		addTrack(kind: 'video' | 'audio'): void {
			const projectId = getActiveProjectId(env)
			env.authority.dispatch({
				c: CMD.TRACK_CREATE,
				p: { projectId, kind },
			})
		},

		selectEntity(entityId: string | null): void {
			env.session.selectEntity(entityId)
		},

		setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void {
			env.session.setActiveInspectorTab(tab)
		},

		renameSelectedClip(name: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clip.id, attrs: { name } } })
		},

		colorSelectedClip(color: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clip.id, attrs: { color } } })
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clip.id, attrs: { opacity: { value: roundToTenths(opacityPercent / 100) } } } })
		},

		updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const key = edge === 'in' ? 'fadeIn' : 'fadeOut'
			const current = Number(attrs[key] ?? 0)
			const nextFade = clamp(roundToTenths(current + delta), 0, attrs.duration)
			env.authority.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clip.id, attrs: { [key]: nextFade } } })
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			env.authority.dispatch({
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
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			env.authority.dispatch({
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
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clip.id, attrs: getResizedClipAttrs(asClipAttrs(clip.attrs), edge, delta) } })
		},

		resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			if (delta === 0) {
				return
			}

			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			env.authority.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clipId, attrs: getResizedClipAttrs(asClipAttrs(clip.attrs), edge, delta) } })
		},

		addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.EFFECT_ADD, p: { id: clip.id, name: `${kind[0].toUpperCase()}${kind.slice(1)}`, kind, amount: kind === 'tint' ? 0.35 : 0.25 } })
		},

		addColorCorrectionToSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.EFFECT_ADD, p: { id: clip.id, name: 'Primary Correction', kind: 'color-correction' } })
		},

		updateEffectAttrs(effectId, attrs): void {
			env.authority.dispatch({ c: CMD.EFFECT_UPDATE_ATTRS, p: { id: effectId, attrs } })
		},

		deleteSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clip.id } }).then(() => {
				env.session.selectEntity(null)
			})
		},

		splitSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const splitTime = clamp(roundToHundredths(env.session.get().cursor), attrs.start + minimumSplitOffset, attrs.start + attrs.duration - minimumSplitOffset)
			env.authority.dispatch({ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: clip.id, time: splitTime } }).then((result) => {
				env.session.selectEntity(String(result.createdIds?.clipId))
			})
		},

		splitClipByIdAt(clipId: string, time: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const splitTime = clamp(roundToHundredths(time), attrs.start + minimumSplitOffset, attrs.start + attrs.duration - minimumSplitOffset)
			env.authority.dispatch({ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: clipId, time: splitTime } }).then((result) => {
				env.session.selectEntity(String(result.createdIds?.clipId))
			})
		},

		removeEffectFromSelectedClip(effectId: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.EFFECT_REMOVE, p: { id: clip.id, effectId } })
		},

		async queueSelectedClipExport(onProgress) {
			const registry = env.stores.getRegistry()
			const session = env.session.get()
			const project = getActiveProject(registry, session)
			const clip = getSelectedClip(registry, session)
			if (!project || !clip) {
				return null
			}

			const result = await env.export.render({ registry: createExportRegistrySnapshot(env, registry), projectId: project.id, range: { type: 'clip', clipId: clip.id }, format: 'video-webm' }, onProgress)
			const downloadUrl = env.media.createObjectUrl(result.blob)
			if (downloadUrl) {
				env.lifecycle.registerObjectUrl(downloadUrl, 'export')
				return { ...result, downloadUrl }
			}

			return result
		},

		async queueProjectExport(onProgress) {
			const registry = env.stores.getRegistry()
			const project = getActiveProject(registry, env.session.get())
			if (!project) {
				return null
			}

			const result = await env.export.render({ registry: createExportRegistrySnapshot(env, registry), projectId: project.id, range: { type: 'project' }, format: 'video-webm' }, onProgress)
			const downloadUrl = env.media.createObjectUrl(result.blob)
			if (downloadUrl) {
				env.lifecycle.registerObjectUrl(downloadUrl, 'export')
				return { ...result, downloadUrl }
			}

			return result
		},

		nudgeSelectedClip(delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			actions.moveClipById(clip.id, delta)
		},

		moveClipById(clipId: string, delta: number): void {
			if (delta === 0) {
				return
			}

			env.authority.dispatch({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: clipId, delta } })
		},

		togglePlayback(): void {
			env.session.setPlaying(!env.session.get().isPlaying)
		},

		setCursor(value: number): void {
			env.session.setCursor(roundToHundredths(value))
		},

		tickPlayback(deltaSeconds: number): void {
			const session = env.session.get()
			if (!session.isPlaying) {
				return
			}

			env.session.setCursor((session.cursor + deltaSeconds) % options.playbackDuration$.get())
		},

		zoomTimeline(delta: number): void {
			const current = env.session.get().timelineZoom
			env.session.setTimelineZoom(clamp(current + delta, 8, 96))
		},
	}

	return actions
}
