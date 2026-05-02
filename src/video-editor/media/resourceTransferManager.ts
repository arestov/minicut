import { observable, type Observable } from '@legendapp/state'
import { DEFAULT_RESOURCE_CHUNK_SIZE, mergeByteRanges } from '../domain/resourceData'
import type { ProjectRegistry, ResourceAttrs, ResourceByteRange } from '../domain/types'
import type { P2PRawTransportLike } from '../p2p/PageP2PManager'
import {
	buildRangeKey,
	getContiguousRangeEnd,
	getHeadPreviewRange,
	getPlayheadWindowRange,
	getTailFallbackRange,
	subtractByteRanges,
} from './resourceTransferScheduler'

type TransferRole = 'server' | 'client' | 'undecided' | null
type TransferReason = 'head' | 'tail' | 'window' | 'sequential' | 'replication'

interface ResourceSnapshot {
	resourceId: string
	kind: ResourceAttrs['kind']
	mime: string
	duration: number
	size?: number
	chunkSize: number
	ownerPeerId: string | null
	sourceKind: ResourceAttrs['source']['kind']
	fallbackUrl: string
	name: string
}

interface LocalResourceEntry extends ResourceSnapshot {
	blob: Blob
	objectUrl: string
}

interface RemoteResourceState extends ResourceSnapshot {
	chunks: Map<number, ArrayBuffer>
	loadedRanges: ResourceByteRange[]
	requestedRanges: ResourceByteRange[]
	requestedHistory: ResourceByteRange[]
	requestEvents: Array<{ reason: TransferReason, ranges: ResourceByteRange[] }>
	loadedBytes: number
	lastTouchedAt: number
	headRequested: boolean
	tailRequested: boolean
	sequentialRequested: boolean
	replicationRequested: boolean
	lastWindowKey: string
	previewUrl: string
	playbackUrl: string
	lastPreviewSignature: string
	lastError: string | null
	errorRetryCount: number
	retryTimeoutId: number | null
	status: 'missing' | 'partial' | 'ready' | 'error'
}

export interface ResourceTransferView {
	resourceId: string
	name: string
	kind: ResourceAttrs['kind']
	ownerPeerId: string | null
	availability: 'local' | 'remote'
	status: 'missing' | 'requesting' | 'partial' | 'ready' | 'error'
	progress: number
	loadedBytes: number
	totalBytes: number
	loadedRanges: ResourceByteRange[]
	requestedRanges: ResourceByteRange[]
	requestedHistory: ResourceByteRange[]
	requestEvents: Array<{ reason: TransferReason, ranges: ResourceByteRange[] }>
	previewUrl: string
	playbackUrl: string
	canPreview: boolean
	tailFallbackRequested: boolean
	lastError: string | null
	sourceKind: ResourceAttrs['source']['kind']
	fallbackUrl: string
	mode: 'local' | 'mirrored' | 'streaming'
}

export interface RequestMessage {
	type: 'resource-request'
	resourceId: string
	ranges: ResourceByteRange[]
	reason: TransferReason
}

interface ChunkMetaMessage {
	type: 'resource-chunk-meta'
	resourceId: string
	index: number
	start: number
	end: number
	totalSize?: number
	mime: string
	kind: ResourceAttrs['kind']
	name: string
	duration: number
	chunkSize: number
	ownerPeerId: string | null
	sourceKind: ResourceAttrs['source']['kind']
	fallbackUrl: string
	reason: TransferReason
}

interface ChunkCompleteMessage {
	type: 'resource-chunk-complete'
	resourceId: string
	reason: TransferReason
}

interface ErrorMessage {
	type: 'resource-error'
	resourceId: string
	error: string
}

type ControlMessage = RequestMessage | ChunkMetaMessage | ChunkCompleteMessage | ErrorMessage

interface AttachedTransport {
	transport: P2PRawTransportLike
	unlisten: () => void
	pendingChunkMeta: ChunkMetaMessage | null
}

export interface CreateResourceTransferManagerOptions {
	getRole: () => TransferRole
	getPeerId: () => string | null
	chunkSize?: number
	chunkSendDelayMs?: number
	maxCachedBytes?: number
	headBytes?: number
	tailBytes?: number
	playheadWindowSeconds?: number
	transfers$?: Observable<Record<string, ResourceTransferView>>
}

export interface ResourceTransferManager {
	readonly transfers$: Observable<Record<string, ResourceTransferView>>
	syncRegistry(registry: ProjectRegistry): void
	registerLocalResource(resourceId: string, file: File | Blob, snapshot: Omit<ResourceSnapshot, 'resourceId'> & { objectUrl: string }): void
	attachClientTransport(transport: P2PRawTransportLike): void
	attachServerTransport(remotePeerId: string, transport: P2PRawTransportLike): void
	detachPeerTransport(remotePeerId: string): void
	resolveResourceUrl(resourceId: string, fallbackUrl: string): string
	requestPlayheadWindow(resourceId: string, time: number): void
	notePreviewError(resourceId: string): void
	getTransfer(resourceId: string): ResourceTransferView | null
	destroy(): void
}

const SERVER_TRANSPORT_KEY = '__server__'
const MAX_ERROR_RETRIES = 3
const ERROR_RETRY_DELAY_MS = 250

const wait = async (ms: number): Promise<void> => {
	if (ms <= 0) {
		return
	}

	await new Promise<void>((resolve) => {
		window.setTimeout(resolve, ms)
	})
}

const computeProgress = (loadedBytes: number, totalBytes: number): number =>
	totalBytes > 0 ? Math.max(0, Math.min(1, loadedBytes / totalBytes)) : loadedBytes > 0 ? 0.01 : 0

const isRealMediaUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http') || url.startsWith('/') || url.startsWith('./')

const toSnapshot = (resourceId: string, attrs: ResourceAttrs, defaultChunkSize: number): ResourceSnapshot => ({
	resourceId,
	kind: attrs.kind,
	mime: attrs.mime,
	duration: Number(attrs.duration) || 0,
	size: typeof attrs.size === 'number' && Number.isFinite(attrs.size) ? attrs.size : undefined,
	chunkSize: Math.max(1, Number(attrs.data?.chunkSize) || defaultChunkSize),
	ownerPeerId: typeof attrs.source?.ownerPeerId === 'string' ? attrs.source.ownerPeerId : null,
	sourceKind: attrs.source?.kind ?? 'local',
	fallbackUrl: String(attrs.url ?? ''),
	name: String(attrs.name ?? resourceId),
})

const getChunkIndexesForRange = (
	range: ResourceByteRange,
	chunkSize: number,
): number[] => {
	const indexes: number[] = []
	const startIndex = Math.floor(range[0] / chunkSize)
	const endIndex = Math.max(startIndex, Math.ceil(range[1] / chunkSize) - 1)
	for (let index = startIndex; index <= endIndex; index += 1) {
		indexes.push(index)
	}
	return indexes
}

const createRemoteState = (snapshot: ResourceSnapshot): RemoteResourceState => ({
	...snapshot,
	chunks: new Map<number, ArrayBuffer>(),
	loadedRanges: [],
	requestedRanges: [],
	requestedHistory: [],
	requestEvents: [],
	loadedBytes: 0,
	lastTouchedAt: Date.now(),
	headRequested: false,
	tailRequested: false,
	sequentialRequested: false,
	replicationRequested: false,
	lastWindowKey: '',
	previewUrl: '',
	playbackUrl: '',
	lastPreviewSignature: '',
	lastError: null,
	errorRetryCount: 0,
	retryTimeoutId: null,
	status: 'missing',
})

export const createResourceTransferManager = (
	options: CreateResourceTransferManagerOptions,
): ResourceTransferManager => {
	const transfers$ = options.transfers$ ?? observable<Record<string, ResourceTransferView>>({})
	const defaultChunkSize = options.chunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	const chunkSendDelayMs = options.chunkSendDelayMs ?? 0
	const maxCachedBytes = options.maxCachedBytes ?? 128 * 1024 * 1024
	const headBytes = options.headBytes
	const tailBytes = options.tailBytes
	const playheadWindowSeconds = options.playheadWindowSeconds
	const localResources = new Map<string, LocalResourceEntry>()
	const remoteStates = new Map<string, RemoteResourceState>()
	const resourceSnapshots = new Map<string, ResourceSnapshot>()
	const transports = new Map<string, AttachedTransport>()
	const peerServeQueues = new Map<string, Promise<void>>()
	let destroyed = false

	const clearRetryTimeout = (state: RemoteResourceState): void => {
		if (state.retryTimeoutId !== null) {
			window.clearTimeout(state.retryTimeoutId)
			state.retryTimeoutId = null
		}
	}

	const revokeRemoteUrls = (state: RemoteResourceState): void => {
		if (state.previewUrl) {
			URL.revokeObjectURL(state.previewUrl)
			state.previewUrl = ''
		}
		if (state.playbackUrl && state.playbackUrl !== state.previewUrl) {
			URL.revokeObjectURL(state.playbackUrl)
			state.playbackUrl = ''
		}
		state.lastPreviewSignature = ''
	}

	const getTransport = (peerKey: string): AttachedTransport | null => transports.get(peerKey) ?? null

	const resetRemoteRequestState = (state: RemoteResourceState): void => {
		clearRetryTimeout(state)
		state.requestedRanges = []
		state.headRequested = false
		state.tailRequested = false
		state.sequentialRequested = false
		state.replicationRequested = false
		state.lastWindowKey = ''
		state.lastError = null
		state.errorRetryCount = 0
		if (state.status !== 'ready') {
			state.status = state.loadedBytes > 0 ? 'partial' : 'missing'
		}
	}

	const resetRemoteRequestsForPeer = (peerKey: string): void => {
		for (const state of remoteStates.values()) {
			if (getRequestPeerKey(state) !== peerKey || state.status === 'ready') {
				continue
			}

			resetRemoteRequestState(state)
			updateTransferView(state.resourceId)
		}
	}

	const enqueuePeerServe = (peerKey: string, work: () => Promise<void>): void => {
		const queued = (peerServeQueues.get(peerKey) ?? Promise.resolve())
			.then(work)
			.catch(() => undefined)
			.finally(() => {
				if (peerServeQueues.get(peerKey) === queued) {
					peerServeQueues.delete(peerKey)
				}
			})
		peerServeQueues.set(peerKey, queued)
	}

	const evictRemoteState = (state: RemoteResourceState): void => {
		clearRetryTimeout(state)
		revokeRemoteUrls(state)
		state.chunks.clear()
		state.loadedRanges = []
		state.requestedRanges = []
		state.loadedBytes = 0
		state.status = 'missing'
		updateTransferView(state.resourceId)
	}

	const enforceCacheCap = (exemptResourceId?: string): void => {
		let totalBytes = Array.from(remoteStates.values()).reduce((sum, state) => sum + state.loadedBytes, 0)
		if (totalBytes <= maxCachedBytes) {
			return
		}

		const candidates = Array.from(remoteStates.values())
			.filter((state) => state.resourceId !== exemptResourceId && state.loadedBytes > 0)
			.sort((left, right) => left.lastTouchedAt - right.lastTouchedAt)

		for (const state of candidates) {
			if (totalBytes <= maxCachedBytes) {
				break
			}

			totalBytes -= state.loadedBytes
			evictRemoteState(state)
		}
	}

	const buildRemoteBlob = (state: RemoteResourceState, requireComplete: boolean): Blob | null => {
		const totalSize = state.size
		if (typeof totalSize === 'number' && Number.isFinite(totalSize) && totalSize > 0) {
			if (requireComplete && state.loadedBytes < totalSize) {
				return null
			}
		}

		const contiguousEnd = getContiguousRangeEnd(state.loadedRanges)
		if (!requireComplete && state.kind !== 'image' && contiguousEnd <= 0) {
			return null
		}

		const targetEnd = requireComplete && typeof totalSize === 'number' && Number.isFinite(totalSize)
			? totalSize
			: contiguousEnd
		if (targetEnd <= 0) {
			return null
		}

		const parts: BlobPart[] = []
		for (const index of getChunkIndexesForRange([0, targetEnd], state.chunkSize)) {
			const chunk = state.chunks.get(index)
			if (!chunk) {
				return null
			}

			parts.push(chunk)
		}

		return new Blob(parts, { type: state.mime })
	}

	const updateTransferView = (resourceId: string): void => {
		const local = localResources.get(resourceId)
		if (local) {
			const totalBytes = local.size ?? local.blob.size
			transfers$[resourceId].set({
				resourceId,
				name: local.name,
				kind: local.kind,
				ownerPeerId: local.ownerPeerId,
				availability: 'local',
				status: 'ready',
				progress: 1,
				loadedBytes: totalBytes,
				totalBytes,
				loadedRanges: totalBytes > 0 ? [[0, totalBytes]] : [],
				requestedRanges: [],
				requestedHistory: [],
				requestEvents: [],
				previewUrl: local.objectUrl,
				playbackUrl: local.objectUrl,
				canPreview: true,
				tailFallbackRequested: false,
				lastError: null,
				sourceKind: local.sourceKind,
				fallbackUrl: local.fallbackUrl,
				mode: 'local',
			})
			return
		}

		const state = remoteStates.get(resourceId)
		if (!state) {
			transfers$[resourceId].delete()
			return
		}

		const totalBytes = state.size ?? 0
		const previewUrl = state.playbackUrl || state.previewUrl || (isRealMediaUrl(state.fallbackUrl) ? state.fallbackUrl : '')
		transfers$[resourceId].set({
			resourceId,
			name: state.name,
			kind: state.kind,
			ownerPeerId: state.ownerPeerId,
			availability: 'remote',
			status: state.lastError
				? 'error'
				: state.status === 'missing' && state.requestedRanges.length > 0
					? 'requesting'
					: state.status,
			progress: computeProgress(state.loadedBytes, totalBytes),
			loadedBytes: state.loadedBytes,
			totalBytes,
			loadedRanges: state.loadedRanges,
			requestedRanges: state.requestedRanges,
			requestedHistory: state.requestedHistory,
			requestEvents: state.requestEvents,
			previewUrl,
			playbackUrl: previewUrl,
			canPreview: previewUrl.length > 0,
			tailFallbackRequested: state.tailRequested,
			lastError: state.lastError,
			sourceKind: state.sourceKind,
			fallbackUrl: state.fallbackUrl,
			mode: state.ownerPeerId && state.ownerPeerId !== options.getPeerId() ? 'streaming' : 'mirrored',
		})
	}

	const rebuildPreviewUrls = (resourceId: string): void => {
		const state = remoteStates.get(resourceId)
		if (!state) {
			return
		}

		const totalBytes = state.size
		const completeBlob = buildRemoteBlob(state, true)
		const partialBlob = completeBlob ?? buildRemoteBlob(state, false)
		const signature = `${state.loadedBytes}:${getContiguousRangeEnd(state.loadedRanges)}:${completeBlob ? 'full' : 'partial'}`
		if (state.lastPreviewSignature === signature) {
			updateTransferView(resourceId)
			return
		}

		revokeRemoteUrls(state)
		state.lastPreviewSignature = signature
		if (completeBlob) {
			const url = URL.createObjectURL(completeBlob)
			state.previewUrl = url
			state.playbackUrl = url
			state.status = typeof totalBytes === 'number' && state.loadedBytes >= totalBytes ? 'ready' : 'partial'
			updateTransferView(resourceId)
			return
		}

		if (partialBlob) {
			const url = URL.createObjectURL(partialBlob)
			state.previewUrl = url
			state.playbackUrl = url
			state.status = state.loadedBytes > 0 ? 'partial' : 'missing'
		}

		updateTransferView(resourceId)
	}

	const sendControl = (peerKey: string, message: ControlMessage): void => {
		if (destroyed) {
			return
		}

		getTransport(peerKey)?.transport.send(JSON.stringify(message))
	}

	const getRequestPeerKey = (snapshot: ResourceSnapshot): string | null => {
		if (options.getRole() === 'server') {
			return snapshot.ownerPeerId && snapshot.ownerPeerId !== options.getPeerId() ? snapshot.ownerPeerId : null
		}

		return options.getRole() === 'client' ? SERVER_TRANSPORT_KEY : null
	}

	const requestRanges = (
		resourceId: string,
		rawRanges: ResourceByteRange[],
		reason: TransferReason,
	): void => {
		const state = remoteStates.get(resourceId)
		if (!state) {
			return
		}

		const peerKey = getRequestPeerKey(state)
		if (!peerKey || !getTransport(peerKey)) {
			return
		}

		const normalizedRanges = mergeByteRanges(rawRanges)
		const missingRanges = subtractByteRanges(normalizedRanges, [...state.loadedRanges, ...state.requestedRanges])
		if (missingRanges.length === 0) {
			return
		}

		state.requestedRanges = mergeByteRanges([...state.requestedRanges, ...missingRanges])
		state.requestedHistory = mergeByteRanges([...state.requestedHistory, ...missingRanges])
		state.requestEvents = [...state.requestEvents.slice(-19), { reason, ranges: missingRanges }]
		if (reason === 'head') {
			state.headRequested = true
		}
		if (reason === 'tail') {
			state.tailRequested = true
		}
		if (reason === 'sequential') {
			state.sequentialRequested = true
		}
		if (reason === 'replication') {
			state.replicationRequested = true
		}
		updateTransferView(resourceId)
		sendControl(peerKey, {
			type: 'resource-request',
			resourceId,
			ranges: missingRanges,
			reason,
		})
	}

	const maybeRequestHead = (resourceId: string): void => {
		const state = remoteStates.get(resourceId)
		if (!state || state.headRequested) {
			return
		}

		const headRange = getHeadPreviewRange(state.size, state.chunkSize, headBytes)
		if (!headRange) {
			return
		}

		requestRanges(resourceId, [headRange], options.getRole() === 'server' ? 'replication' : 'head')
	}

	const maybeContinueSequential = (resourceId: string): void => {
		const state = remoteStates.get(resourceId)
		if (!state || state.sequentialRequested) {
			return
		}

		if (typeof state.size !== 'number' || !Number.isFinite(state.size) || state.size <= 0) {
			return
		}

		const contiguousEnd = getContiguousRangeEnd(state.loadedRanges)
		if (contiguousEnd <= 0 || contiguousEnd >= state.size) {
			return
		}

		requestRanges(resourceId, [[contiguousEnd, state.size]], options.getRole() === 'server' ? 'replication' : 'sequential')
	}

	const requestMissingRanges = (resourceId: string): void => {
		const state = remoteStates.get(resourceId)
		if (!state) {
			return
		}

		if (typeof state.size !== 'number' || !Number.isFinite(state.size) || state.size <= 0) {
			maybeRequestHead(resourceId)
			return
		}

		const missingRanges = subtractByteRanges([[0, state.size]], state.loadedRanges)
		if (missingRanges.length === 0) {
			return
		}

		requestRanges(
			resourceId,
			missingRanges,
			options.getRole() === 'server' ? 'replication' : state.loadedBytes > 0 ? 'sequential' : 'head',
		)
	}

	const ensureRemoteState = (snapshot: ResourceSnapshot): RemoteResourceState => {
		const existing = remoteStates.get(snapshot.resourceId)
		if (existing) {
			existing.kind = snapshot.kind
			existing.mime = snapshot.mime
			existing.duration = snapshot.duration
			existing.size = snapshot.size
			existing.chunkSize = snapshot.chunkSize
			existing.ownerPeerId = snapshot.ownerPeerId
			existing.sourceKind = snapshot.sourceKind
			existing.fallbackUrl = snapshot.fallbackUrl
			existing.name = snapshot.name
			return existing
		}

		const created = createRemoteState(snapshot)
		remoteStates.set(snapshot.resourceId, created)
		return created
	}

	const applyChunkMeta = (resourceId: string, meta: ChunkMetaMessage, buffer: ArrayBuffer): void => {
		if (!Number.isInteger(meta.index) || meta.index < 0) {
			return
		}
		if (!Number.isFinite(meta.start) || !Number.isFinite(meta.end) || meta.end <= meta.start) {
			return
		}
		if (meta.end - meta.start !== buffer.byteLength) {
			return
		}
		if (meta.start !== meta.index * Math.max(1, meta.chunkSize)) {
			return
		}

		const baseSnapshot = resourceSnapshots.get(resourceId) ?? {
			resourceId,
			kind: meta.kind,
			mime: meta.mime,
			duration: meta.duration,
			size: meta.totalSize,
			chunkSize: meta.chunkSize,
			ownerPeerId: meta.ownerPeerId,
			sourceKind: meta.sourceKind,
			fallbackUrl: meta.fallbackUrl,
			name: meta.name,
		}
		resourceSnapshots.set(resourceId, baseSnapshot)
		const state = ensureRemoteState(baseSnapshot)
		if (typeof state.size === 'number' && Number.isFinite(state.size) && state.size > 0) {
			const maxIndex = Math.ceil(state.size / state.chunkSize)
			if (meta.index >= maxIndex || meta.end > state.size) {
				return
			}
		}
		if (!state.chunks.has(meta.index)) {
			state.chunks.set(meta.index, buffer.slice(0))
		}
		state.loadedRanges = mergeByteRanges([...state.loadedRanges, [meta.start, meta.end]])
		state.requestedRanges = subtractByteRanges(state.requestedRanges, [[meta.start, meta.end]])
		state.loadedBytes = Array.from(state.chunks.values()).reduce((sum, chunk) => sum + chunk.byteLength, 0)
		state.lastTouchedAt = Date.now()
		state.status = typeof state.size === 'number' && state.loadedBytes >= state.size ? 'ready' : 'partial'
		state.lastError = null
		clearRetryTimeout(state)
		state.errorRetryCount = 0
		rebuildPreviewUrls(resourceId)
		enforceCacheCap(resourceId)
		maybeContinueSequential(resourceId)
	}

	const handleError = (message: ErrorMessage): void => {
		const state = remoteStates.get(message.resourceId)
		if (!state) {
			return
		}

		clearRetryTimeout(state)
		state.lastError = message.error
		if (state.errorRetryCount >= MAX_ERROR_RETRIES) {
			state.status = 'error'
			updateTransferView(message.resourceId)
			return
		}

		state.errorRetryCount += 1
		state.status = state.loadedBytes > 0 ? 'partial' : 'missing'
		updateTransferView(message.resourceId)
		state.retryTimeoutId = window.setTimeout(() => {
			state.retryTimeoutId = null
			if (destroyed || !remoteStates.has(message.resourceId)) {
				return
			}

			resetRemoteRequestState(state)
			updateTransferView(message.resourceId)
			requestMissingRanges(message.resourceId)
		}, ERROR_RETRY_DELAY_MS * 2 ** (state.errorRetryCount - 1))
	}

	const serveLocalBlobRanges = async (
		peerKey: string,
		resource: LocalResourceEntry,
		ranges: ResourceByteRange[],
		reason: TransferReason,
	): Promise<void> => {
		for (const range of mergeByteRanges(ranges)) {
			for (const index of getChunkIndexesForRange(range, resource.chunkSize)) {
				const start = index * resource.chunkSize
				const end = typeof resource.size === 'number'
					? Math.min(resource.size, start + resource.chunkSize)
					: start + resource.chunkSize
				if (end <= start) {
					continue
				}
				const buffer = await resource.blob.slice(start, end).arrayBuffer()
				sendControl(peerKey, {
					type: 'resource-chunk-meta',
					resourceId: resource.resourceId,
					index,
					start,
					end,
					totalSize: resource.size,
					mime: resource.mime,
					kind: resource.kind,
					name: resource.name,
					duration: resource.duration,
					chunkSize: resource.chunkSize,
					ownerPeerId: resource.ownerPeerId,
					sourceKind: resource.sourceKind,
					fallbackUrl: resource.fallbackUrl,
					reason,
				})
				getTransport(peerKey)?.transport.send(buffer)
				await wait(chunkSendDelayMs)
			}
		}
		sendControl(peerKey, {
			type: 'resource-chunk-complete',
			resourceId: resource.resourceId,
			reason,
		})
	}

	const serveMirroredRanges = async (
		peerKey: string,
		state: RemoteResourceState,
		ranges: ResourceByteRange[],
		reason: TransferReason,
	): Promise<void> => {
		for (const range of mergeByteRanges(ranges)) {
			for (const index of getChunkIndexesForRange(range, state.chunkSize)) {
				const buffer = state.chunks.get(index)
				if (!buffer) {
					continue
				}
				const start = index * state.chunkSize
				const end = start + buffer.byteLength
				sendControl(peerKey, {
					type: 'resource-chunk-meta',
					resourceId: state.resourceId,
					index,
					start,
					end,
					totalSize: state.size,
					mime: state.mime,
					kind: state.kind,
					name: state.name,
					duration: state.duration,
					chunkSize: state.chunkSize,
					ownerPeerId: state.ownerPeerId,
					sourceKind: state.sourceKind,
					fallbackUrl: state.fallbackUrl,
					reason,
				})
				getTransport(peerKey)?.transport.send(buffer.slice(0))
				await wait(chunkSendDelayMs)
			}
		}
		sendControl(peerKey, {
			type: 'resource-chunk-complete',
			resourceId: state.resourceId,
			reason,
		})
	}

	const handleRequest = (peerKey: string, message: RequestMessage): void => {
		const local = localResources.get(message.resourceId)
		if (local) {
			enqueuePeerServe(peerKey, async () => {
				try {
					await serveLocalBlobRanges(peerKey, local, message.ranges, message.reason)
				} catch (error) {
					sendControl(peerKey, {
						type: 'resource-error',
						resourceId: message.resourceId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
			return
		}

		const state = remoteStates.get(message.resourceId)
		if (!state) {
			sendControl(peerKey, {
				type: 'resource-error',
				resourceId: message.resourceId,
				error: 'Unknown resource',
			})
			return
		}

		enqueuePeerServe(peerKey, async () => {
			try {
				await serveMirroredRanges(peerKey, state, message.ranges, message.reason)
			} catch (error) {
				sendControl(peerKey, {
					type: 'resource-error',
					resourceId: message.resourceId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		})

		if (options.getRole() === 'server' && state.ownerPeerId && state.ownerPeerId !== options.getPeerId()) {
			requestRanges(state.resourceId, message.ranges, 'replication')
		}
	}

	const handleControlMessage = (peerKey: string, message: ControlMessage): void => {
		switch (message.type) {
			case 'resource-request':
				handleRequest(peerKey, message)
				return
			case 'resource-chunk-meta': {
				const attached = getTransport(peerKey)
				if (attached) {
					attached.pendingChunkMeta = message
				}
				return
			}
			case 'resource-chunk-complete': {
				const state = remoteStates.get(message.resourceId)
				if (!state) {
					return
				}
				state.requestedRanges = []
				updateTransferView(message.resourceId)
				requestMissingRanges(message.resourceId)
				return
			}
			case 'resource-error':
				handleError(message)
				return
		}
	}

	const handleTransportData = (peerKey: string, data: string | ArrayBuffer): void => {
		if (typeof data === 'string') {
			let parsed: unknown
			try {
				parsed = JSON.parse(data)
			} catch {
				return
			}

			if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
				return
			}

			handleControlMessage(peerKey, parsed as ControlMessage)
			return
		}

		const attached = getTransport(peerKey)
		const meta = attached?.pendingChunkMeta
		if (!attached || !meta) {
			return
		}

		attached.pendingChunkMeta = null
		applyChunkMeta(meta.resourceId, meta, data)
	}

	const attachTransport = (peerKey: string, transport: P2PRawTransportLike): void => {
		transports.get(peerKey)?.unlisten()
		transports.get(peerKey)?.transport.destroy()
		const unlisten = transport.listen((data) => {
			if (!destroyed) {
				handleTransportData(peerKey, data)
			}
		})
		transports.set(peerKey, {
			transport,
			unlisten,
			pendingChunkMeta: null,
		})
	}

	return {
		transfers$,

		syncRegistry(registry) {
			if (destroyed) {
				return
			}

			for (const [resourceId, entity] of Object.entries(registry.entitiesById)) {
				if (entity.type !== 'resource') {
					continue
				}

				const snapshot = toSnapshot(resourceId, entity.attrs as ResourceAttrs, defaultChunkSize)
				resourceSnapshots.set(resourceId, snapshot)
				if (localResources.has(resourceId)) {
					const local = localResources.get(resourceId)
					if (local) {
						local.kind = snapshot.kind
						local.mime = snapshot.mime
						local.duration = snapshot.duration
						local.size = snapshot.size
						local.chunkSize = snapshot.chunkSize
						local.ownerPeerId = snapshot.ownerPeerId
						local.sourceKind = snapshot.sourceKind
						local.fallbackUrl = snapshot.fallbackUrl
						local.name = snapshot.name
					}
					updateTransferView(resourceId)
					continue
				}

				ensureRemoteState(snapshot)
				updateTransferView(resourceId)
				if (snapshot.sourceKind === 'p2p' && snapshot.ownerPeerId !== options.getPeerId()) {
					maybeRequestHead(resourceId)
				}
			}
		},

		registerLocalResource(resourceId, file, snapshot) {
			if (destroyed) {
				return
			}

			const existing = localResources.get(resourceId)
			if (existing && existing.objectUrl !== snapshot.objectUrl) {
				URL.revokeObjectURL(existing.objectUrl)
			}

			localResources.set(resourceId, {
				resourceId,
				blob: file,
				objectUrl: snapshot.objectUrl,
				kind: snapshot.kind,
				mime: snapshot.mime,
				duration: snapshot.duration,
				size: snapshot.size ?? file.size,
				chunkSize: snapshot.chunkSize,
				ownerPeerId: snapshot.ownerPeerId,
				sourceKind: snapshot.sourceKind,
				fallbackUrl: snapshot.fallbackUrl,
				name: snapshot.name,
			})
			remoteStates.delete(resourceId)
			updateTransferView(resourceId)
		},

		attachClientTransport(transport) {
			attachTransport(SERVER_TRANSPORT_KEY, transport)
			resetRemoteRequestsForPeer(SERVER_TRANSPORT_KEY)
			for (const [resourceId, snapshot] of resourceSnapshots) {
				if (snapshot.sourceKind === 'p2p' && snapshot.ownerPeerId !== options.getPeerId()) {
					maybeRequestHead(resourceId)
				}
			}
		},

		attachServerTransport(remotePeerId, transport) {
			attachTransport(remotePeerId, transport)
			resetRemoteRequestsForPeer(remotePeerId)
			for (const [resourceId, snapshot] of resourceSnapshots) {
				if (snapshot.ownerPeerId === remotePeerId && snapshot.sourceKind === 'p2p') {
					maybeRequestHead(resourceId)
				}
			}
		},

		detachPeerTransport(remotePeerId) {
			const attached = transports.get(remotePeerId)
			if (!attached) {
				return
			}

			attached.unlisten()
			attached.transport.destroy()
			transports.delete(remotePeerId)
			peerServeQueues.delete(remotePeerId)
			resetRemoteRequestsForPeer(remotePeerId)
		},

		resolveResourceUrl(resourceId, fallbackUrl) {
			const local = localResources.get(resourceId)
			if (local) {
				return local.objectUrl
			}

			const transfer = transfers$[resourceId].get()
			if (transfer?.playbackUrl) {
				return transfer.playbackUrl
			}

			return fallbackUrl
		},

		requestPlayheadWindow(resourceId, time) {
			const state = remoteStates.get(resourceId)
			if (!state || state.kind === 'image') {
				return
			}

			const range = getPlayheadWindowRange({
				totalSize: state.size,
				duration: state.duration,
				time,
				chunkSize: state.chunkSize,
				windowSeconds: playheadWindowSeconds,
			})
			const rangeKey = buildRangeKey(range)
			if (!range || rangeKey === state.lastWindowKey) {
				return
			}

			state.lastWindowKey = rangeKey
			requestRanges(resourceId, [range], 'window')
		},

		notePreviewError(resourceId) {
			const state = remoteStates.get(resourceId)
			if (!state || state.tailRequested) {
				return
			}

			const tailRange = getTailFallbackRange(state.size, state.chunkSize, tailBytes)
			if (!tailRange) {
				return
			}

			requestRanges(resourceId, [tailRange], 'tail')
		},

		getTransfer(resourceId) {
			return transfers$[resourceId].get() ?? null
		},

		destroy() {
			if (destroyed) {
				return
			}

			destroyed = true
			for (const attached of transports.values()) {
				attached.unlisten()
				attached.transport.destroy()
			}
			transports.clear()
			peerServeQueues.clear()
			for (const local of localResources.values()) {
				URL.revokeObjectURL(local.objectUrl)
			}
			for (const state of remoteStates.values()) {
				clearRetryTimeout(state)
				revokeRemoteUrls(state)
			}
			localResources.clear()
			remoteStates.clear()
			resourceSnapshots.clear()
		},
	}
}
