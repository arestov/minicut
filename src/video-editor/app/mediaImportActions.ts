import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import { getActiveProject, getAudioTrack, getProjectMetaList, getVideoTrack } from '../domain/selectors'
import { CMD } from '../domain/types'
import { getActionActiveProjectId, isProjectTimelineEmpty } from './actionRuntimeSelectors'
import type { CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import type { EditorActionEnvironment } from './editorActionEnvironment'

const sampleKindCycle = ['video', 'audio', 'image'] as const

export const createMediaImportActions = (
	env: EditorActionEnvironment,
	options: CreateLegendActionRuntimeOptions,
	getActions: () => VideoEditorHarnessActions,
): Pick<VideoEditorHarnessActions, 'importSampleResource' | 'importFiles' | 'addResourceToTimeline' | 'addTextClip'> => {
	const resourceChunkSize = options.resourceChunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	let importFilesQueue = Promise.resolve()

	const addResourceToTimelineIfEmpty = (projectId: string, resourceId: string): void => {
		if (env.lifecycle.isDestroyed() || !isProjectTimelineEmpty(env.stores.getRegistry(), projectId)) {
			return
		}

		getActions().addResourceToTimeline(resourceId)
	}

	const getAuthorityPeerId = (): string | null => {
		const peerId = (env.authority.client as Partial<{ peerId: unknown }>).peerId
		return typeof peerId === 'string' ? peerId : null
	}

	return {
		importSampleResource(): void {
			const projectId = getActionActiveProjectId(env)
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
			const projectId = getActionActiveProjectId(env)
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
			const projectId = getActionActiveProjectId(env)
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
			const projectId = getActionActiveProjectId(env)
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
	}
}
