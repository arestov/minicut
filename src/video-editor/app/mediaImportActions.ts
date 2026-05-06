import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import { createProjectImportFilesEffectPayload, PROJECT_IMPORT_FILES_FX } from '../models/Project/effects'
import { createTextAddCommand } from '../domain/actionCommandBuilders'
import { getActionActiveProjectId } from './actionRuntimeSelectors'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import type { EditorActionEnvironment } from './editorActionEnvironment'

const sampleKindCycle = ['video', 'audio', 'image'] as const
let sampleResourceSequence = 0
let importedResourceSequence = 0

const createDktResourceSourceId = (prefix: string): string => {
	importedResourceSequence += 1
	return `${prefix}:${Date.now().toString(36)}:${importedResourceSequence}`
}

export const createMediaImportActions = (
	env: EditorActionEnvironment,
	options: CreateDktActionRuntimeOptions,
	getActions: () => VideoEditorHarnessActions,
): Pick<VideoEditorHarnessActions, 'importSampleResource' | 'importFiles' | 'addResourceToTimeline' | 'addTextClip'> => {
	const resourceChunkSize = options.resourceChunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	let importFilesQueue = Promise.resolve()

	const getAuthorityPeerId = (): string | null => {
		const peerId = (env.authority.client as Partial<{ peerId: unknown }>).peerId
		return typeof peerId === 'string' ? peerId : null
	}

	return {
		importSampleResource(): void {
			const projectId = getActionActiveProjectId(env)
			sampleResourceSequence += 1
			const resourceOrdinal = sampleResourceSequence
			const kind = sampleKindCycle[(resourceOrdinal - 1) % sampleKindCycle.length]
			const resource = {
				sourceResourceId: createDktResourceSourceId('sample-resource'),
					name: `Sample asset ${resourceOrdinal}`,
					kind,
					duration: 4 + resourceOrdinal,
					mime: `${kind}/sample`,
					url: `sample://asset-${resourceOrdinal}`,
					width: kind === 'audio' ? undefined : 1920,
					height: kind === 'audio' ? undefined : 1080,
			}
			void Promise.resolve(env.dkt?.dispatchProjectAction({ sourceProjectId: projectId }, 'importResource', resource)).catch(() => undefined)
		},

		importFiles(files: FileList | File[]): void {
			const projectId = getActionActiveProjectId(env)
			const task = env.tasks.dispatchTask(PROJECT_IMPORT_FILES_FX, createProjectImportFilesEffectPayload(files, { projectId }))
			if (task.dropped) {
				return
			}

			const runtimeRefId = task.payload.runtimeRefId
			const runtimeRef = runtimeRefId ? env.tasks.consumeRuntimeRef(runtimeRefId) : null
			const inputFiles = Array.isArray(runtimeRef) ? runtimeRef : []
			for (const file of inputFiles) {
				if (!(file instanceof File)) {
					continue
				}

				const kind = env.media.getFileKind(file)
				if (!kind) {
					continue
				}
				const name = file.name
				const mime = file.type || `${kind}/unknown`
				const size = file.size

				const url = env.media.createObjectUrl(file)
				if (!url) {
					continue
				}
				env.lifecycle.registerObjectUrl(url, 'import')
				const durationPromise = env.media.getImportedResourceDuration(url, kind)
				importFilesQueue = importFilesQueue.then(async () => {
					const duration = await durationPromise
					if (env.lifecycle.isDestroyed()) {
						return
					}

					const ownerPeerId = getAuthorityPeerId()
					const source = ownerPeerId
						? { kind: 'p2p' as const, ownerPeerId }
						: { kind: 'local' as const }
					const resourceId = createDktResourceSourceId('imported-resource')
					const resource = {
						sourceResourceId: resourceId,
						name,
						kind,
						duration,
						mime,
						url: source.kind === 'p2p' ? '' : url,
						width: kind === 'audio' ? undefined : 1920,
						height: kind === 'audio' ? undefined : 1080,
						size,
						source,
						status: source.kind === 'p2p' ? 'missing' : 'ready',
						data: {
							chunkSize: resourceChunkSize,
							dataStatus: source.kind === 'p2p' ? 'missing' : 'ready',
						},
					}

					void Promise.resolve(env.dkt?.dispatchProjectAction({ sourceProjectId: projectId }, 'importResource', resource)).then(() => {
						if (!env.lifecycle.isDestroyed()) {
							env.transfers.manager.registerLocalResource(resourceId, file, {
								objectUrl: url,
								kind,
								mime,
								duration,
								size,
								chunkSize: resourceChunkSize,
								ownerPeerId,
								sourceKind: source.kind,
								fallbackUrl: source.kind === 'p2p' ? '' : url,
								name,
							})
						}
					}).catch(() => undefined)
				})
			}

			env.tasks.completeTask(task)
		},

		addResourceToTimeline(resourceId: string): void {
			void Promise.resolve(env.dkt?.dispatchResourceAction({ sourceResourceId: resourceId }, 'requestAddToTimeline', { resourceId })).catch(() => undefined)
		},

		addTextClip(content = 'Title'): void {
			const projectId = getActionActiveProjectId(env)
			env.authority.dispatch(createTextAddCommand({ projectId, content })).then((result) => {
				const clipId = result.createdIds?.clipId
				if (clipId) {
					env.session.selectEntity(String(clipId))
				}
			})
		},
	}
}
