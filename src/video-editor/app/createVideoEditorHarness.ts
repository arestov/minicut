import { createPlaybackDuration$ } from '../read-model/previewReadModel'
import { createProjectsStore } from '../dkt/state/projectStore'
import { createSessionStore } from '../dkt/state/sessionStore'
import { createMiniCutPageSyncRuntime } from '../dkt/runtime/createMiniCutPageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import type {
	Command,
	DispatchResult,
	EditorSessionState,
	ProjectRegistry,
} from '../domain/types'
import { createResourceTransferManager } from '../media/resourceTransferManager'
import type { ExportRenderer } from '../render/exportRenderer'
import { createDktPageEditorRenderRuntime } from '../render-sync/createDktPageEditorRenderRuntime'
import { createProjectRegistryFromPageRuntime } from '../render-sync/projectRegistryFromPageRuntime'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createDktActionRuntime } from './createDktActionRuntime'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import { createRuntimeTaskFacade } from './runtimeTaskFacade'
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from './platform'

const SNAPSHOT_BOOTSTRAP_RETRY_MS = 250
const EMPTY_CLEANUP = () => {}

let bootstrapProjectSequence = 0
let harnessSessionSequence = 0

const createBootstrapProjectId = (): string => {
	bootstrapProjectSequence += 1
	return `project:bootstrap:${Date.now().toString(36)}:${bootstrapProjectSequence}`
}

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

const resolveActiveProjectId = (
	registry: ProjectRegistry,
	session: Pick<EditorSessionState, 'activeProjectId'>,
): string | null => {
	const sessionProjectId = session.activeProjectId
	if (sessionProjectId && registry.projects[sessionProjectId]) {
		return sessionProjectId
	}

	const registryProjectId = registry.activeProjectId
	if (registryProjectId && registry.projects[registryProjectId]) {
		return registryProjectId
	}

	return Object.keys(registry.projects)[0] ?? null
}

const createMiniCutPageRuntime = (authorityClient: EditorAuthorityClient) => {
	if (typeof authorityClient.openDktTransport !== 'function') {
		return null
	}

	return createMiniCutPageSyncRuntime({ transport: authorityClient.openDktTransport() })
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
	const pageRuntime = createMiniCutPageRuntime(authorityClient)
	if (pageRuntime) {
		harnessSessionSequence += 1
		pageRuntime.bootstrap({ sessionKey: `harness:${Date.now().toString(36)}:${harnessSessionSequence}` })
	}
	const playbackDuration$ = createPlaybackDuration$(projects$, session$)
	const importedObjectUrls = new Set<string>()
	const exportObjectUrls = new Set<string>()
	let initialBootstrapChecked = false
	let projectBootstrapInFlight = false
	let isDestroyed = false
	let initialProjectRetryTimer: ReturnType<typeof setTimeout> | null = null
	const runtimeTasks = createRuntimeTaskFacade()
	type MiniCutDktRuntime = ReturnType<typeof import('../dkt/runtime/createMiniCutDktRuntime')['createMiniCutDktRuntime']>
	let dktRuntime: MiniCutDktRuntime | null = null
	const getDktRuntime = async (): Promise<MiniCutDktRuntime> => {
		if (!dktRuntime) {
			const { createMiniCutDktRuntime } = await import('../dkt/runtime/createMiniCutDktRuntime')
			dktRuntime = createMiniCutDktRuntime({ enabled: true })
		}

		return dktRuntime
	}

	const readDktRegistryView = (): ProjectRegistry => {
		const registry = createProjectRegistryFromPageRuntime(pageRuntime)
		resourceTransferManager.syncRegistry(registry)
		return registry
	}

	const getPagePioneerScope = (): ReactSyncScopeHandle | null => {
		const rootScope = pageRuntime?.getRootScope() ?? null
		return rootScope ? pageRuntime?.readOne(rootScope, 'pioneer') ?? null : null
	}

	const scopeSourceId = (scope: ReactSyncScopeHandle, attrName: string): string | null => {
		const value = pageRuntime?.readAttrs(scope, [attrName])[attrName]
		return typeof value === 'string' && value ? value : null
	}

	const findProjectScope = (projectId: string): ReactSyncScopeHandle | null => {
		const pioneer = getPagePioneerScope()
		if (!pioneer || !pageRuntime) {
			return null
		}

		const projects = pageRuntime.readMany(pioneer, 'project')
		const matched = projects.find((scope) => scopeSourceId(scope, 'sourceProjectId') === projectId)
		if (matched) {
			return matched
		}

		return session$.activeProjectId.get() === projectId
			? projects[projects.length - 1] ?? projects[0] ?? null
			: null
	}

	const findTrackScope = (trackId: string): ReactSyncScopeHandle | null => {
		if (!pageRuntime) {
			return null
		}
		const pioneer = getPagePioneerScope()
		const projects = pioneer ? pageRuntime.readMany(pioneer, 'project') : []
		for (const project of projects) {
			const track = pageRuntime.readMany(project, 'tracks')
				.find((scope) => scopeSourceId(scope, 'sourceTrackId') === trackId)
			if (track) {
				return track
			}
		}
		return null
	}

	const findResourceScope = (resourceId: string): ReactSyncScopeHandle | null => {
		if (!pageRuntime) {
			return null
		}
		const pioneer = getPagePioneerScope()
		const projects = pioneer ? pageRuntime.readMany(pioneer, 'project') : []
		for (const project of projects) {
			const resource = pageRuntime.readMany(project, 'resources')
				.find((scope) => scopeSourceId(scope, 'sourceResourceId') === resourceId)
			if (resource) {
				return resource
			}
		}
		return null
	}

	const findClipScope = (clipId: string): ReactSyncScopeHandle | null => {
		if (!pageRuntime) {
			return null
		}
		const pioneer = getPagePioneerScope()
		const projects = pioneer ? pageRuntime.readMany(pioneer, 'project') : []
		for (const project of projects) {
			for (const track of pageRuntime.readMany(project, 'tracks')) {
				const clip = pageRuntime.readMany(track, 'clips')
					.find((scope) => scopeSourceId(scope, 'sourceClipId') === clipId)
				if (clip) {
					return clip
				}
			}
		}
		return null
	}

	const findTextScope = (textId: string): ReactSyncScopeHandle | null => {
		if (!pageRuntime) {
			return null
		}
		const clip = findClipScope(textId)
		if (clip) {
			return clip
		}
		const pioneer = getPagePioneerScope()
		const projects = pioneer ? pageRuntime.readMany(pioneer, 'project') : []
		for (const project of projects) {
			for (const track of pageRuntime.readMany(project, 'tracks')) {
				for (const clipScope of pageRuntime.readMany(track, 'clips')) {
					const text = pageRuntime.readOne(clipScope, 'text')
					if (text && scopeSourceId(text, 'sourceTextId') === textId) {
						return text
					}
				}
			}
		}
		return null
	}

	const findEffectScope = (effectId: string): ReactSyncScopeHandle | null => {
		if (!pageRuntime) {
			return null
		}
		const pioneer = getPagePioneerScope()
		const projects = pioneer ? pageRuntime.readMany(pioneer, 'project') : []
		for (const project of projects) {
			for (const track of pageRuntime.readMany(project, 'tracks')) {
				for (const clip of pageRuntime.readMany(track, 'clips')) {
					const effect = pageRuntime.readMany(clip, 'effects')
						.find((scope) => scopeSourceId(scope, 'sourceEffectId') === effectId)
					if (effect) {
						return effect
					}
				}
			}
		}
		return null
	}

	const getAuthorityRole = (): 'server' | 'client' | 'undecided' | null => {
		const role = (authorityClient as Partial<{ role: unknown }>).role
		if (role === 'server' || role === 'client' || role === 'undecided') {
			return role
		}

		return null
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
		const registry = readDktRegistryView()
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

		const registry = readDktRegistryView()
		if (Object.keys(registry.projects).length > 0 || projectBootstrapInFlight) {
			syncActiveProjectSelection()
			return
		}

		projectBootstrapInFlight = true
		const projectId = createBootstrapProjectId()
		getDktRuntime().then(async (runtime) => {
			await runtime.dispatchSessionAction('createProject', {
				sourceProjectId: projectId,
				title: 'Untitled project',
			})
		}).then(() => {
			if (isDestroyed) {
				return
			}

			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
		}).finally(() => {
			projectBootstrapInFlight = false
		})
	}

	const unsubscribe = pageRuntime?.subscribe(() => {
		if (isDestroyed) {
			return
		}
		readDktRegistryView()
		syncActiveProjectSelection()
	}) ?? EMPTY_CLEANUP

	ensureInitialProject()

	const dispatch = (command: Command): Promise<DispatchResult> =>
		Promise.resolve(authorityClient.dispatch(command))

	const actionEnvironment: EditorActionEnvironment = {
		stores: {
			projects$,
			getRegistry: readDktRegistryView,
			applySnapshot: () => {},
			applyPatchEnvelope: () => {},
		},
		authority: {
			client: authorityClient,
			dispatch,
			getSnapshot: () => authorityClient.getSnapshot(),
			subscribe: (listener) => authorityClient.subscribe(listener),
		},
		session: {
			session$,
			get: () => session$.get(),
			setActiveProject: (projectId) => {
				session$.activeProjectId.set(projectId)
					pageRuntime?.dispatchAction('setActiveProject', projectId, pageRuntime.getRootScope())
			},
			selectEntity: (entityId) => {
				session$.selectedEntityId.set(entityId)
					pageRuntime?.dispatchAction('selectEntity', entityId, pageRuntime.getRootScope())
			},
			setCursor: (value) => {
				session$.cursor.set(value)
					pageRuntime?.dispatchAction('setCursor', value, pageRuntime.getRootScope())
			},
			setPlaying: (value) => {
				session$.isPlaying.set(value)
					pageRuntime?.dispatchAction('setPlaying', value, pageRuntime.getRootScope())
			},
			setTimelineZoom: (value) => {
				session$.timelineZoom.set(value)
					pageRuntime?.dispatchAction('setTimelineZoom', value, pageRuntime.getRootScope())
			},
			setActiveInspectorTab: (tab) => {
				session$.activeInspectorTab.set(tab)
					pageRuntime?.dispatchAction('setActiveInspectorTab', tab, pageRuntime.getRootScope())
			},
		},
		media: {
			getFileKind,
			createObjectUrl: (blob) => platform.createObjectUrl(blob),
			revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
			getImportedResourceDuration: (url, kind) => platform.getImportedResourceDuration(url, kind),
		},
		export: {
			renderer: exportRenderer,
			render: (request, onProgress) => onProgress
				? exportRenderer.render(request, onProgress)
				: exportRenderer.render(request),
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
		tasks: {
			dispatchTask: (fxName, payload, taskOptions) => runtimeTasks.dispatchTask(fxName, payload, taskOptions),
			consumeRuntimeRef: (runtimeRefId) => runtimeTasks.consumeRuntimeRef(runtimeRefId),
			deleteRuntimeRef: (runtimeRefId) => runtimeTasks.deleteRuntimeRef(runtimeRefId),
			completeTask: (task) => runtimeTasks.completeTask(task),
		},
		dkt: {
			dispatchSessionAction: async (actionName, payload) => {
				if (pageRuntime) {
					pageRuntime.dispatchAction(actionName, payload, pageRuntime.getRootScope())
					return
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchSessionAction(actionName, payload)
			},
			dispatchProjectAction: async (project, actionName, payload) => {
				if (pageRuntime) {
					const scope = findProjectScope(project.sourceProjectId)
					if (scope) {
						pageRuntime.dispatchAction(actionName, payload, scope)
						return
					}
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchProjectAction(project, actionName, payload)
			},
			dispatchTrackAction: async (track, actionName, payload) => {
				if (pageRuntime) {
					const scope = findTrackScope(track.sourceTrackId)
					if (scope) {
						pageRuntime.dispatchAction(actionName, payload, scope)
						return
					}
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchTrackAction(track, actionName, payload)
			},
			dispatchResourceAction: async (resource, actionName, payload) => {
				if (pageRuntime) {
					const scope = findResourceScope(resource.sourceResourceId)
					if (scope) {
						pageRuntime.dispatchAction(actionName, payload, scope)
						return
					}
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchResourceAction(resource, actionName, payload)
			},
			dispatchClipAction: async (clip, actionName, payload) => {
				if (pageRuntime) {
					const scope = findClipScope(clip.sourceClipId)
					if (scope) {
						pageRuntime.dispatchAction(actionName, payload, scope)
						return
					}
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchClipAction(clip, actionName, payload)
			},
			dispatchTextAction: async (text, actionName, payload) => {
				if (pageRuntime) {
					const scope = findTextScope(text.sourceTextId)
					if (scope) {
						pageRuntime.dispatchAction(actionName, payload, scope)
						return
					}
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchTextAction(text, actionName, payload)
			},
			dispatchEffectAction: async (effect, actionName, payload) => {
				if (pageRuntime) {
					const scope = findEffectScope(effect.sourceEffectId)
					if (scope) {
						pageRuntime.dispatchAction(actionName, payload, scope)
						return
					}
				}

				const runtime = await getDktRuntime()
				await runtime.dispatchEffectAction(effect, actionName, payload)
			},
		},
		platform,
	}

	const actions = createDktActionRuntime(actionEnvironment, {
		playbackDuration$,
		resourceChunkSize,
	})
	const renderRuntime = createDktPageEditorRenderRuntime({
		pageRuntime,
		actions,
	})

	return {
		worker: authorityClient,
		projects$,
		session$,
		pageRuntime,
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
			runtimeTasks.clear()
			clearInitialProjectRetry()
			unsubscribe()
			for (const url of importedObjectUrls) {
				platform.revokeObjectUrl(url)
			}
			resourceTransferManager.destroy()
			pageRuntime?.destroy()
			authorityClient.destroy?.()
			for (const url of exportObjectUrls) {
				platform.revokeObjectUrl(url)
			}
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
