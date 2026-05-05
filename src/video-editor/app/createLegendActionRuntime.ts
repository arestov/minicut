import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import { buildEditorActionCommand } from '../domain/actionCommandBuilders'
import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import { getActiveProject, getAudioTrack, getClipIdsForTrack, getProjectMetaList, getSelectedClip, getTracks, getVideoTrack } from '../domain/selectors'
import type { ClipAttrs, ProjectRegistry, ResourceAttrs, TextAttrs } from '../domain/types'
import { CMD } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createSessionRootActions } from './sessionRootActions'

const sampleKindCycle = ['video', 'audio', 'image'] as const
const minimumSplitOffset = 0.01

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs
const asResourceAttrs = (attrs: Record<string, unknown>): ResourceAttrs => attrs as unknown as ResourceAttrs

const createScope = (nodeId: string, type: EditorActionScope['type']): EditorActionScope => ({ nodeId, type })

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

	const dispatchBuiltCommand = <Name extends EditorActionName>(scope: EditorActionScope, name: Name, payload: EditorActionPayload<Name>): void => {
		const result = buildEditorActionCommand({ scope, name, payload }, {
			registry: env.stores.getRegistry(),
			activeProjectId: getActiveProjectId(env),
		})
		if (result.type === 'command') {
			env.authority.dispatch(result.command)
		}
	}
	const sessionRootActions = createSessionRootActions(env, options, dispatchBuiltCommand)

	const actions: VideoEditorHarnessActions = {
		...sessionRootActions,

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

			actions.updateTextById(textId, attrs)
		},

		renameClipById(clipId: string, name: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'rename', { name })
		},

		renameSelectedClip(name: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.renameClipById(clip.id, name)
			}
		},

		colorClipById(clipId: string, color: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'color', { color })
		},

		colorSelectedClip(color: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.colorClipById(clip.id, color)
			}
		},

		updateClipOpacityById(clipId: string, opacityPercent: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setOpacity', { opacityPercent })
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipOpacityById(clip.id, opacityPercent)
			}
		},

		updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setFade', { edge, delta })
		},

		updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipFadeById(clip.id, edge, delta)
			}
		},

		updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setTransform', partial)
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipTransformById(clip.id, partial)
			}
		},

		updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setAudio', partial)
		},

		updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipAudioById(clip.id, partial)
			}
		},

		trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'trim', { edge, delta })
		},

		trimSelectedClip(edge: 'start' | 'end', delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.trimClipById(clip.id, edge, delta)
			}
		},

		resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			if (delta === 0) {
				return
			}

			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'resize', { edge, delta })
		},

		addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'addEffect', { kind })
		},

		addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.addEffectToClip(clip.id, kind)
			}
		},

		addColorCorrectionToClip(clipId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'addColorCorrection', undefined)
		},

		addColorCorrectionToSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.addColorCorrectionToClip(clip.id)
			}
		},

		updateTextById(textId: string, attrs: Partial<TextAttrs>): void {
			dispatchBuiltCommand(createScope(textId, 'text'), 'updateText', attrs)
		},

		updateEffectAttrs(effectId, attrs): void {
			dispatchBuiltCommand(createScope(effectId, 'effect'), 'updateEffect', attrs)
		},

		deleteClipById(clipId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			env.authority.dispatch({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } }).then(() => {
				if (env.session.get().selectedEntityId === clipId) {
					env.session.selectEntity(null)
				}
			})
		},

		deleteSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.deleteClipById(clip.id)
			}
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

		removeEffectFromClip(clipId: string, effectId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'removeEffect', { effectId })
		},

		removeEffectFromSelectedClip(effectId: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.removeEffectFromClip(clip.id, effectId)
			}
		},

		async queueClipExportById(clipId, onProgress) {
			const registry = env.stores.getRegistry()
			const project = getActiveProject(registry, env.session.get())
			const clip = registry.entitiesById[clipId]
			if (!project || !clip) {
				return null
			}

			const result = await env.export.render({ registry: createExportRegistrySnapshot(env, registry), projectId: project.id, range: { type: 'clip', clipId }, format: 'video-webm' }, onProgress)
			const downloadUrl = env.media.createObjectUrl(result.blob)
			if (downloadUrl) {
				env.lifecycle.registerObjectUrl(downloadUrl, 'export')
				return { ...result, downloadUrl }
			}

			return result
		},

		async queueSelectedClipExport(onProgress) {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			return clip ? actions.queueClipExportById(clip.id, onProgress) : null
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

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'moveBy', { delta })
		},
	}

	return actions
}
