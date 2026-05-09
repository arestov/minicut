import { useEffect, useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { createBrowserHarnessPlatform } from './platform'
import { VideoEditorApp } from '../components/VideoEditorApp'
import { DktEditorRoot } from '../ui/dkt/DktEditorRoot'
import { createDefaultRtcConfig } from '../p2p/PageP2PManager'
import { resolveRoomUrlState, type RoomUrlResolution } from './roomUrlState'
import '../components/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
	dktBootstrapOptions?: Parameters<NonNullable<VideoEditorHarness['pageRuntime']>['bootstrap']>[0] | null
}

const LAST_ROOM_STORAGE_KEY = 'minicut:last-room-id'

const summarizeGraph = (graph: unknown) => {
	if (!graph || typeof graph !== 'object') {
		return graph
	}

	const value = graph as {
		nodes?: Array<{ nodeId?: unknown; modelName?: unknown; rels?: unknown; attrsVersion?: unknown; relsVersion?: unknown }>
		models?: Record<string, { attrs?: unknown; rels?: Array<{ name?: unknown }> }>
	}
	const summary: Record<string, unknown> = {}

	if (Array.isArray(value.nodes)) {
		summary.nodes = value.nodes.map((node) => ({
			nodeId: node.nodeId,
			modelName: node.modelName,
			relNames: node.rels && typeof node.rels === 'object' ? Object.keys(node.rels as Record<string, unknown>) : [],
			attrsVersion: node.attrsVersion,
			relsVersion: node.relsVersion,
		}))
	}

	if (value.models && typeof value.models === 'object') {
		summary.models = Object.fromEntries(
			Object.entries(value.models).map(([modelName, model]) => [
				modelName,
				{
					attrsCount: Array.isArray(model.attrs) ? model.attrs.length : undefined,
					relNames: Array.isArray(model.rels)
						? model.rels.map((rel) => rel.name).filter((name): name is string => typeof name === 'string')
						: undefined,
				},
			]),
		)
	}

	return summary
}

const normalizeList = (raw: string | null | undefined): string[] =>
	String(raw ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value.length > 0)

const resolveSignalUrl = (): string | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const raw = new URLSearchParams(window.location.search).get('signalUrl')
	if (!raw) {
		const envSignalUrl = (import.meta.env as Record<string, unknown>).VITE_MINICUT_SIGNAL_URL
		if (typeof envSignalUrl !== 'string' || envSignalUrl.length === 0) {
			return null
		}

		try {
			return new URL(envSignalUrl, window.location.origin).toString().replace(/\/$/, '')
		} catch {
			return null
		}
	}

	try {
		return new URL(raw, window.location.origin).toString().replace(/\/$/, '')
	} catch {
		return null
	}
}

const resolveTurnIceServer = (): RTCIceServer | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const params = new URLSearchParams(window.location.search)
	const env = import.meta.env as Record<string, unknown>
	const queryUrls = params.getAll('turnUrl').flatMap((value) => normalizeList(value))
	const envUrls = normalizeList(typeof env.VITE_MINICUT_TURN_URLS === 'string' ? env.VITE_MINICUT_TURN_URLS : undefined)
	const urls = queryUrls.length > 0 ? queryUrls : envUrls
	const username = params.get('turnUsername')
		?? (typeof env.VITE_MINICUT_TURN_USERNAME === 'string' ? env.VITE_MINICUT_TURN_USERNAME : null)
	const credential = params.get('turnCredential')
		?? (typeof env.VITE_MINICUT_TURN_CREDENTIAL === 'string' ? env.VITE_MINICUT_TURN_CREDENTIAL : null)

	if (urls.length === 0 || !username || !credential) {
		return null
	}

	return {
		urls: urls.length === 1 ? urls[0] : urls,
		username,
		credential,
	}
}

const resolveBrowserRoom = (): RoomUrlResolution | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const resolved = resolveRoomUrlState({
		hash: window.location.hash,
		lastRoomId: window.localStorage.getItem(LAST_ROOM_STORAGE_KEY),
	})
	window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, resolved.roomId)
	if (resolved.shouldReplace) {
		window.history.replaceState(window.history.state, '', resolved.canonicalHash)
	}

	return resolved
}

const resolveMediaTransferOptions = (): {
	chunkSize?: number
	chunkSendDelayMs?: number
	headBytes?: number
	tailBytes?: number
	playheadWindowSeconds?: number
} => {
	if (typeof window === 'undefined') {
		return {}
	}

	const params = new URLSearchParams(window.location.search)
	const getNumber = (key: string): number | undefined => {
		const raw = params.get(key)
		if (!raw) {
			return undefined
		}
		const parsed = Number(raw)
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
	}

	return {
		chunkSize: getNumber('transferChunkSize'),
		chunkSendDelayMs: getNumber('transferChunkDelayMs'),
		headBytes: getNumber('transferHeadBytes'),
		tailBytes: getNumber('transferTailBytes'),
		playheadWindowSeconds: getNumber('transferPlayheadWindowSeconds'),
	}
}

export const VideoEditorHarnessApp = ({
	dktBootstrapOptions,
	harness: providedHarness,
}: VideoEditorHarnessAppProps) => {
	const resolvedDktBootstrapOptions = useMemo(() => {
		if (dktBootstrapOptions !== undefined) {
			return dktBootstrapOptions
		}

		const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2)
		return { sessionKey: `minicut-${randomPart}` }
	}, [dktBootstrapOptions])
	const resolvedRoom = useMemo(() => resolveBrowserRoom(), [])
	const signalUrl = useMemo(() => resolveSignalUrl(), [])
	const rtcConfig = useMemo(() => createDefaultRtcConfig(resolveTurnIceServer()), [])
	const mediaTransferOptions = useMemo(() => resolveMediaTransferOptions(), [])
	const ownedHarness = useMemo(() => {
		if (providedHarness) {
			return providedHarness
		}

		if (!resolvedRoom || !signalUrl) {
			return createVideoEditorHarness(undefined, {
				platform: createBrowserHarnessPlatform(),
			})
		}

		const authorityOptions = {
			p2p: {
				roomId: resolvedRoom.roomId,
				signalUrl,
				rtcConfig,
				onSessionLost(reason: string) {
					console.warn('[minicut:p2p] app observed session loss', {
						roomId: resolvedRoom.roomId,
						reason,
					})
				},
				onError(error: unknown) {
					console.warn('[minicut:p2p] app observed p2p error', {
						roomId: resolvedRoom.roomId,
						error,
					})
				},
			},
		}

		return createVideoEditorHarness(undefined, {
			mediaTransferOptions,
			platform: createBrowserHarnessPlatform({ authorityOptions }),
		})
	}, [mediaTransferOptions, providedHarness, resolvedRoom, rtcConfig, signalUrl])

	useEffect(() => {
		if (typeof window === 'undefined') {
			return
		}

		const getActiveProjectScope = () => {
			const runtime = ownedHarness.pageRuntime
			const rootScope = runtime?.getRootScope()
			if (!runtime || !rootScope) {
				return null
			}

			return runtime.readOne(rootScope, 'activeProject')
		}

		const debug = {
			getSnapshot: () => ownedHarness.pageRuntime?.getSnapshot() ?? null,
			dumpGraph: () => ownedHarness.pageRuntime?.debugDumpGraph?.() ?? null,
			dumpGraphSummary: () => summarizeGraph(ownedHarness.pageRuntime?.debugDumpGraph?.() ?? null),
			dumpRuntimeTasks: () => ownedHarness.debugDumpRuntimeTasksTesting?.() ?? null,
			dumpProjectState: () => {
				const graph = ownedHarness.pageRuntime?.debugDumpGraph?.() as
					| {
						rootNodeId?: unknown
						dict?: unknown
						nodes?: unknown
					  }
					| null

				if (!graph) {
					return null
				}

				type GraphNode = {
					nodeId?: unknown
					id?: unknown
					_node_id?: unknown
					modelName?: unknown
					model_name?: unknown
					attrs?: unknown
					rels?: unknown
				}

				const nodeIdOf = (node: GraphNode | null | undefined): string | null => {
					if (!node) {
						return null
					}
					const candidate = node.nodeId ?? node.id ?? node._node_id
					return typeof candidate === 'string' ? candidate : null
				}

				const extractNodeIds = (value: unknown): string[] => {
					if (!value) {
						return []
					}

					if (typeof value === 'string') {
						return [value]
					}

					if (Array.isArray(value)) {
						return value.flatMap((item) => extractNodeIds(item))
					}

					if (typeof value === 'object') {
						const obj = value as Record<string, unknown>
						const directId = obj.nodeId ?? obj.id ?? obj._node_id
						if (typeof directId === 'string') {
							return [directId]
						}

						return Object.values(obj).flatMap((item) => extractNodeIds(item))
					}

					return []
				}

				const nodes: GraphNode[] = []
				if (Array.isArray(graph.nodes)) {
					nodes.push(...(graph.nodes as GraphNode[]))
				}

				if (graph.dict && typeof graph.dict === 'object') {
					for (const value of Object.values(graph.dict as Record<string, unknown>)) {
						if (value && typeof value === 'object') {
							nodes.push(value as GraphNode)
						}
					}
				}

				const nodesById = new Map<string, GraphNode>()
				for (const node of nodes) {
					const id = nodeIdOf(node)
					if (id) {
						nodesById.set(id, node)
					}
				}

				const getNode = (id: string | null): GraphNode | null => {
					if (!id) {
						return null
					}
					return nodesById.get(id) ?? null
				}

				const getRels = (node: GraphNode | null): Record<string, unknown> => {
					if (!node || !node.rels || typeof node.rels !== 'object') {
						return {}
					}
					return node.rels as Record<string, unknown>
				}

				const getAttrs = (node: GraphNode | null): Record<string, unknown> => {
					if (!node || !node.attrs || typeof node.attrs !== 'object') {
						return {}
					}
					return node.attrs as Record<string, unknown>
				}

				const getRelIds = (node: GraphNode | null, relName: string): string[] => {
					const rels = getRels(node)
					return extractNodeIds(rels[relName])
				}

				const rootNodeId = typeof graph.rootNodeId === 'string' ? graph.rootNodeId : null
				const rootNode = getNode(rootNodeId)

				const activeProjectId = getRelIds(rootNode, 'activeProject')[0] ?? null
				const pioneerId = getRelIds(rootNode, 'pioneer')[0] ?? null
				const pioneerNode = getNode(pioneerId)
				const fallbackProjectId = getRelIds(pioneerNode, 'project')[0] ?? null
				const projectNodeId = activeProjectId ?? fallbackProjectId
				const projectNode = getNode(projectNodeId)

				const trackIds = getRelIds(projectNode, 'tracks')
				const tracks = trackIds.map((trackId) => {
					const trackNode = getNode(trackId)
					const clipIds = getRelIds(trackNode, 'clips')
					const clips = clipIds.map((clipId) => {
						const clipNode = getNode(clipId)
						return {
							nodeId: clipId,
							model: (clipNode?.modelName ?? clipNode?.model_name ?? null) as string | null,
							attrs: getAttrs(clipNode),
						}
					})

					return {
						nodeId: trackId,
						model: (trackNode?.modelName ?? trackNode?.model_name ?? null) as string | null,
						attrs: getAttrs(trackNode),
						clipIds,
						clips,
					}
				})

				const resourceIds = getRelIds(projectNode, 'resources')
				const resources = resourceIds.map((resourceId) => {
					const resourceNode = getNode(resourceId)
					return {
						nodeId: resourceId,
						model: (resourceNode?.modelName ?? resourceNode?.model_name ?? null) as string | null,
						attrs: getAttrs(resourceNode),
					}
				})

				return {
					rootNodeId,
					activeProjectNodeId: activeProjectId,
					projectNodeId,
					projectModel: (projectNode?.modelName ?? projectNode?.model_name ?? null) as string | null,
					projectAttrs: getAttrs(projectNode),
					trackIds,
					tracks,
					resourceIds,
					resources,
					nodesCount: nodesById.size,
				}
			},
			getResourceTransfers: () => Object.values(ownedHarness.resourceTransfers$.get()).map((transfer) => ({
				resourceId: transfer.resourceId,
				name: transfer.name,
				ownerPeerId: transfer.ownerPeerId,
				status: transfer.status,
				progress: transfer.progress,
				totalBytes: transfer.totalBytes,
				loadedBytes: transfer.loadedBytes,
				previewUrl: transfer.previewUrl,
				loadedRanges: transfer.loadedRanges,
				requestedRanges: transfer.requestedRanges,
				requestedRangesLog: transfer.requestedRangesLog,
				requestEvents: transfer.requestEvents,
				mode: transfer.mode,
				availability: transfer.availability,
				lastError: transfer.lastError,
			})),
			getProjectCount: () => {
				const runtime = ownedHarness.pageRuntime
				const rootScope = runtime?.getRootScope()
				const pioneerScope = rootScope ? runtime?.readOne(rootScope, 'pioneer') : null
				if (!runtime || !pioneerScope) {
					return 0
				}

				return runtime.readMany(pioneerScope, 'project').length
			},
			getProjectTitles: () => {
				const runtime = ownedHarness.pageRuntime
				const rootScope = runtime?.getRootScope()
				const pioneerScope = rootScope ? runtime?.readOne(rootScope, 'pioneer') : null
				if (!runtime || !pioneerScope) {
					return []
				}

				return runtime.readMany(pioneerScope, 'project').map((scope) => {
					const attrs = runtime.readAttrs(scope, ['title']) as {
						title?: unknown
					}
					return typeof attrs.title === 'string' ? attrs.title : 'Project'
				})
			},
			getActiveProjectTracks: () => {
				const runtime = ownedHarness.pageRuntime
				const projectScope = getActiveProjectScope()
				if (!runtime || !projectScope) {
					return []
				}

				return runtime.readMany(projectScope, 'tracks').map((trackScope) => {
					const trackAttrs = runtime.readAttrs(trackScope, ['name', 'kind']) as {
						name?: unknown
						kind?: unknown
					}
					const clipSummaries = runtime.readMany(trackScope, 'clips').map((clipScope) => {
						const clipAttrs = runtime.readAttrs(clipScope, ['name', 'mediaKind', 'sourceClipId']) as {
							name?: unknown
							mediaKind?: unknown
							sourceClipId?: unknown
						}
						return {
							name: typeof clipAttrs.name === 'string' ? clipAttrs.name : 'Clip',
							mediaKind: typeof clipAttrs.mediaKind === 'string' ? clipAttrs.mediaKind : null,
							sourceClipId: typeof clipAttrs.sourceClipId === 'string' ? clipAttrs.sourceClipId : null,
						}
					})
					return {
						name: typeof trackAttrs.name === 'string' ? trackAttrs.name : 'Track',
						kind: typeof trackAttrs.kind === 'string' ? trackAttrs.kind : null,
						clips: clipSummaries,
					}
				})
			},
			getActiveProjectPrimaryTracks: () => {
				const runtime = ownedHarness.pageRuntime
				const projectScope = getActiveProjectScope()
				if (!runtime || !projectScope) {
					return null
				}

				const videoTrack = runtime.readOne(projectScope, 'primaryVideoTrack')
				const audioTrack = runtime.readOne(projectScope, 'primaryAudioTrack')
				const readTrackName = (trackScope: ReturnType<typeof runtime.readOne>) => {
					if (!trackScope) {
						return null
					}
					const attrs = runtime.readAttrs(trackScope, ['name', 'kind']) as { name?: unknown; kind?: unknown }
					return {
						name: typeof attrs.name === 'string' ? attrs.name : 'Track',
						kind: typeof attrs.kind === 'string' ? attrs.kind : null,
					}
				}

				return {
					video: readTrackName(videoTrack),
					audio: readTrackName(audioTrack),
				}
			},
			getSelectionState: () => {
				const runtime = ownedHarness.pageRuntime
				const rootScope = runtime?.getRootScope()
				if (!runtime || !rootScope) {
					return null
				}
				const attrs = runtime.readAttrs(rootScope, ['selectedEntityId', 'selectedClipSummary']) as {
					selectedEntityId?: unknown
					selectedClipSummary?: unknown
				}
				const selectedClip = runtime.readOne(rootScope, 'selectedClip')
				const clipAttrs = selectedClip
					? runtime.readAttrs(selectedClip, ['sourceClipId', 'name', 'mediaKind']) as {
						sourceClipId?: unknown
						name?: unknown
						mediaKind?: unknown
					  }
					: null
				return {
					selectedEntityId: typeof attrs.selectedEntityId === 'string' ? attrs.selectedEntityId : null,
					selectedClipSummary: attrs.selectedClipSummary ?? null,
					selectedClip: clipAttrs
						? {
							sourceClipId: typeof clipAttrs.sourceClipId === 'string' ? clipAttrs.sourceClipId : null,
							name: typeof clipAttrs.name === 'string' ? clipAttrs.name : null,
							mediaKind: typeof clipAttrs.mediaKind === 'string' ? clipAttrs.mediaKind : null,
						}
						: null,
				}
			},
			getActiveProjectDetails: () => {
				const runtime = ownedHarness.pageRuntime
				const projectScope = getActiveProjectScope()
				if (!runtime || !projectScope) {
					return null
				}

				const projectAttrs = runtime.readAttrs(projectScope, ['title', 'duration', 'timelineDuration', 'sourceProjectId']) as {
					title?: unknown
					duration?: unknown
					timelineDuration?: unknown
					sourceProjectId?: unknown
				}

				const tracks = runtime.readMany(projectScope, 'tracks').map((trackScope) => {
					const trackAttrs = runtime.readAttrs(trackScope, ['name', 'kind', 'muted', 'locked', 'height']) as {
						name?: unknown
						kind?: unknown
						muted?: unknown
						locked?: unknown
						height?: unknown
					}
					const clips = runtime.readMany(trackScope, 'clips').map((clipScope) => {
						const clipAttrs = runtime.readAttrs(clipScope, ['sourceClipId', 'sourceResourceId', 'sourceResourceName', 'name', 'mediaKind', 'start', 'in', 'duration']) as {
							sourceClipId?: unknown
							sourceResourceId?: unknown
							sourceResourceName?: unknown
							name?: unknown
							mediaKind?: unknown
							start?: unknown
							in?: unknown
							duration?: unknown
						}
						return {
							nodeId: clipScope._nodeId,
							sourceClipId: typeof clipAttrs.sourceClipId === 'string' ? clipAttrs.sourceClipId : null,
							sourceResourceId: typeof clipAttrs.sourceResourceId === 'string' ? clipAttrs.sourceResourceId : null,
							sourceResourceName: typeof clipAttrs.sourceResourceName === 'string' ? clipAttrs.sourceResourceName : null,
							name: typeof clipAttrs.name === 'string' ? clipAttrs.name : 'Clip',
							mediaKind: typeof clipAttrs.mediaKind === 'string' ? clipAttrs.mediaKind : null,
							start: typeof clipAttrs.start === 'number' ? clipAttrs.start : null,
							in: typeof clipAttrs.in === 'number' ? clipAttrs.in : null,
							duration: typeof clipAttrs.duration === 'number' ? clipAttrs.duration : null,
						}
					})

					return {
						nodeId: trackScope._nodeId,
						name: typeof trackAttrs.name === 'string' ? trackAttrs.name : 'Track',
						kind: typeof trackAttrs.kind === 'string' ? trackAttrs.kind : null,
						muted: trackAttrs.muted === true,
						locked: trackAttrs.locked === true,
						height: typeof trackAttrs.height === 'number' ? trackAttrs.height : null,
						clips,
					}
				})

				const resources = runtime.readMany(projectScope, 'resources').map((resourceScope) => {
					const resourceAttrs = runtime.readAttrs(resourceScope, ['sourceResourceId', 'name', 'kind', 'duration', 'status']) as {
						sourceResourceId?: unknown
						name?: unknown
						kind?: unknown
						duration?: unknown
						status?: unknown
					}
					return {
						nodeId: resourceScope._nodeId,
						sourceResourceId: typeof resourceAttrs.sourceResourceId === 'string' ? resourceAttrs.sourceResourceId : null,
						name: typeof resourceAttrs.name === 'string' ? resourceAttrs.name : 'Resource',
						kind: typeof resourceAttrs.kind === 'string' ? resourceAttrs.kind : null,
						duration: typeof resourceAttrs.duration === 'number' ? resourceAttrs.duration : null,
						status: typeof resourceAttrs.status === 'string' ? resourceAttrs.status : null,
					}
				})

				return {
					nodeId: projectScope._nodeId,
					sourceProjectId: typeof projectAttrs.sourceProjectId === 'string' ? projectAttrs.sourceProjectId : null,
					title: typeof projectAttrs.title === 'string' ? projectAttrs.title : 'Project',
					duration: typeof projectAttrs.duration === 'number' ? projectAttrs.duration : null,
					timelineDuration: typeof projectAttrs.timelineDuration === 'number' ? projectAttrs.timelineDuration : null,
					tracks,
					resources,
				}
			},
			getRuntimeMessages: () => ownedHarness.pageRuntime?.debugMessages?.() ?? [],
			dumpWorkerState: () => ownedHarness.pageRuntime?.requestDebugDump?.() ?? Promise.resolve(null),
			getRole: () => {
				const worker = ownedHarness.worker as { role?: string }
				return typeof worker.role === 'string' ? worker.role : null
			},
			isRuntimeReady: () => {
				return ownedHarness.pageRuntime?.getSnapshot().ready ?? false
			},
			getPeerId: () => {
				const worker = ownedHarness.worker as { peerId?: string }
				return typeof worker.peerId === 'string' ? worker.peerId : null
			},
			createProject: (title?: string) => {
				ownedHarness.actions.createProject(title)
			},
			dispatchRootAction: (actionName: string, payload?: unknown) => {
				ownedHarness.pageRuntime?.dispatch(actionName, payload, null)
			},
			dispatchProjectAction: (actionName: string, payload?: unknown) => {
				const projectScope = getActiveProjectScope()
				if (!projectScope) {
					throw new Error('No active project')
				}
				ownedHarness.pageRuntime?.dispatch(actionName, payload, projectScope)
			},
			setCursor: (cursor: number) => {
				ownedHarness.actions.setCursor(cursor)
			},
			createProjectDebug: (title?: string) => {
				// Phase 4: debug-only method for testing. If runtime isn't ready,
				// this will silently fail; use regular createProject for production flow.
				ownedHarness.actions.createProject(title)
			},
		}

		;(window as typeof window & { __MINICUT_P2P_DEBUG__?: typeof debug }).__MINICUT_P2P_DEBUG__ = debug

		return () => {
			const current = (window as typeof window & { __MINICUT_P2P_DEBUG__?: typeof debug }).__MINICUT_P2P_DEBUG__
			if (current === debug) {
				delete (window as typeof window & { __MINICUT_P2P_DEBUG__?: typeof debug }).__MINICUT_P2P_DEBUG__
			}
		}
	}, [ownedHarness])

	return (
		<VideoEditorProvider value={ownedHarness}>
			<DktEditorRoot runtime={ownedHarness.pageRuntime} bootstrapOptions={resolvedDktBootstrapOptions}>
				<VideoEditorApp />
			</DktEditorRoot>
		</VideoEditorProvider>
	)
}
