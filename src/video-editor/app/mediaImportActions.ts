import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import { createProjectImportFilesEffectPayload, PROJECT_IMPORT_FILES_FX } from '../models/Project/effects'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'

const sampleKindCycle = ['video', 'audio', 'image'] as const
let sampleResourceSequence = 0
let importedResourceSequence = 0

const createDktResourceSourceId = (prefix: string): string => {
	importedResourceSequence += 1
	return `${prefix}:${Date.now().toString(36)}:${importedResourceSequence}`
}

const getActiveProjectScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => {
	const rootScope = env.dkt?.getRootScope()
	if (!rootScope) {
		return null
	}

	return env.dkt?.readOne(rootScope, 'activeProject') ?? null
}

export const createMediaImportActions = (
	env: EditorActionEnvironment,
	options: CreateDktActionRuntimeOptions,
	getActions: () => VideoEditorHarnessActions,
): Pick<VideoEditorHarnessActions, 'importSampleResource' | 'importFiles' | 'addResourceToTimeline' | 'addTextClip'> => {
	const resourceChunkSize = options.resourceChunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	let importFilesQueue = Promise.resolve()

	return {
		importSampleResource(): void {
			const projectScope = getActiveProjectScope(env)
			if (!projectScope) {
				return
			}

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
			env.dkt?.dispatch('importResource', resource, projectScope)
		},

		importFiles(files: FileList | File[]): void {
			const projectScope = getActiveProjectScope(env)
			if (!projectScope) {
				return
			}

			const task = env.tasks.dispatchTask(PROJECT_IMPORT_FILES_FX, createProjectImportFilesEffectPayload(files, { projectId: '' }))
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
				const capturedProjectScope = projectScope
				importFilesQueue = importFilesQueue.then(async () => {
					const duration = await durationPromise
					if (env.lifecycle.isDestroyed()) {
						return
					}

					const ownerPeerId = env.transfers.getPeerId()
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

					env.dkt?.dispatch('importResource', resource, capturedProjectScope)
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
				})
			}

			env.tasks.completeTask(task)
		},

		addResourceToTimeline(resourceId: string): void {
			// Find resource scope by sourceResourceId and dispatch requestAddToTimeline
			const dkt = env.dkt
			if (!dkt) {
				return
			}

			const rootScope = dkt.getRootScope()
			if (!rootScope) {
				return
			}

			const projectScope = dkt.readOne(rootScope, 'activeProject')
			if (!projectScope) {
				return
			}

			for (const resourceScope of dkt.readMany(projectScope, 'resources')) {
				if (dkt.readAttrs(resourceScope, ['sourceResourceId']).sourceResourceId === resourceId) {
					dkt.dispatch('requestAddToTimeline', { resourceId }, resourceScope)
					return
				}
			}
		},

		addTextClip(content = 'Title'): void {
			const dkt = env.dkt
			if (!dkt) {
				return
			}

			const rootScope = dkt.getRootScope()
			if (!rootScope) {
				return
			}

			const projectScope = dkt.readOne(rootScope, 'activeProject')
			if (!projectScope) {
				return
			}

			// Find first video track
			let targetTrackScope: ReactSyncScopeHandle | null = null
			for (const trackScope of dkt.readMany(projectScope, 'tracks')) {
				const kind = dkt.readAttrs(trackScope, ['kind']).kind
				if (kind === 'video') {
					targetTrackScope = trackScope
					break
				}
			}
			if (!targetTrackScope) {
				const trackScopes = dkt.readMany(projectScope, 'tracks')
				targetTrackScope = trackScopes[0] ?? null
			}

			if (!targetTrackScope) {
				return
			}

			const cursor = dkt.readAttrs(rootScope, ['cursor']).cursor
			const cursorNum = typeof cursor === 'number' ? cursor : 0
			const clipId = createDktResourceSourceId('text-clip')
			const textId = createDktResourceSourceId('text-node')
			dkt.dispatch('addTextClip', {
				sourceClipId: clipId,
				sourceTextId: textId,
				name: content,
				mediaKind: 'video',
				start: Number.isFinite(cursorNum) ? cursorNum : 0,
				in: 0,
				duration: 4,
				text: {
					sourceTextId: textId,
					content,
				},
			}, targetTrackScope)

			dkt.dispatch('selectEntity', clipId, rootScope)
		},
	}
}

