import { DEFAULT_RESOURCE_CHUNK_SIZE, mergeByteRanges } from '../domain/resourceData'
import type { ResourceAttrs } from '../render/registryTypes'
import type { ResourceByteRange, ResourceSourceKind } from '../domain/types'
import type { P2PRawTransportLike } from '../p2p/PageP2PManager'
import {
	buildRangeKey,
	getContiguousRangeEnd,
	getHeadPreviewRange,
	getNextSequentialRange,
	getPlayheadWindowRange,
	getTailFallbackRange,
	intersectByteRanges,
	subtractByteRanges,
} from './resourceTransferScheduler'

type TransferRole = 'server' | 'client' | 'undecided' | null
type TransferReason = 'head' | 'tail' | 'window' | 'sequential' | 'replication'

type RequestPhase = 'request' | 'chunk-meta' | 'chunk-complete' | 'error'

interface RequestEventEntry {
	reason: TransferReason
	ranges: ResourceByteRange[]
	requestId: string
	phase: RequestPhase
}

interface ResourceSnapshot {
	resourceId: string
	kind: ResourceAttrs['kind']
	mime: string
	duration: number
	size?: number
	chunkSize: number
	ownerPeerId: string | null
	sourceKind: ResourceSourceKind
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
	requestedRangesLog: ResourceByteRange[]
	requestEvents: RequestEventEntry[]
	pendingRequestIds: Set<string>
	loadedBytes: number
	lastTouchedAt: number
	tailRequested: boolean
	lastWindowKey: string
	lastWindowRange: ResourceByteRange | null
	previewUrl: string
	playbackUrl: string
	lastPreviewSignature: string
	lastError: string | null
	errorRetryCount: number
	retryTimeoutId: number | null
	readyRecheckTimeoutId: number | null
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
	requestedRangesLog: ResourceByteRange[]
	requestEvents: RequestEventEntry[]
	previewUrl: string
	playbackUrl: string
	canPreview: boolean
	tailFallbackRequested: boolean
	lastError: string | null
	sourceKind: ResourceSourceKind
	fallbackUrl: string
	mode: 'local' | 'mirrored' | 'streaming'
}

export interface RequestMessage {
	type: 'resource-request'
	resourceId: string
	ranges: ResourceByteRange[]
	reason: TransferReason
	requestId: string
}

interface ChunkMetaMessage {
	type: 'resource-chunk-meta'
	resourceId: string
	requestId?: string
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
	sourceKind: ResourceSourceKind
	fallbackUrl: string
	reason: TransferReason
}

interface ChunkCompleteMessage {
	type: 'resource-chunk-complete'
	resourceId: string
	reason: TransferReason
	requestId?: string
}

interface ErrorMessage {
	type: 'resource-error'
	resourceId: string
	error: string
	reason?: TransferReason
	requestId?: string
}

type ControlMessage = RequestMessage | ChunkMetaMessage | ChunkCompleteMessage | ErrorMessage

interface AttachedTransport {
	transport: P2PRawTransportLike
	unlisten: () => void
	pendingChunkMeta: ChunkMetaMessage | null
	generation: number
}

export interface ResourceTransferStore {
	get(): Record<string, ResourceTransferView>
	getItem(resourceId: string): ResourceTransferView | undefined
	setItem(resourceId: string, view: ResourceTransferView): void
	deleteItem(resourceId: string): void
}

const createResourceTransferStore = (): ResourceTransferStore => {
	let state: Record<string, ResourceTransferView> = {}

	return {
		get: () => state,
		getItem: (resourceId: string) => state[resourceId],
		setItem: (resourceId: string, view: ResourceTransferView) => {
			state = {
				...state,
				[resourceId]: view,
			}
		},
		deleteItem: (resourceId: string) => {
			if (!(resourceId in state)) {
				return
			}

			const { [resourceId]: _ignored, ...rest } = state
			state = rest
		},
	}
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
	transfers$?: ResourceTransferStore
}

export interface ResourceTransferManager {
	readonly transfers$: ResourceTransferStore
	syncResources(resources: Array<{ resourceId: string; attrs: ResourceAttrs }>): void
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
const READY_CONFIRM_DELAY_MS = 120
const ZERO_FILL_BLOB_CHUNK_BYTES = 256 * 1024
const MAX_SPARSE_PREVIEW_BLOB_BYTES = 64 * 1024 * 1024
const ZERO_FILL_BLOB = new Blob([new Uint8Array(ZERO_FILL_BLOB_CHUNK_BYTES)])

const wait = async (ms: number): Promise<void> => {
	if (ms <= 0) {
		return
	}

	await new Promise<void>((resolve) => {
		window.setTimeout(resolve, ms)
	})
}

let requestSequence = 0

const nextRequestId = (): string => {
	requestSequence += 1
	return `rq-${requestSequence}`
}

const computeProgress = (loadedBytes: number, totalBytes: number, isReady: boolean): number => {
	if (totalBytes > 0) {
		const normalized = Math.max(0, Math.min(1, loadedBytes / totalBytes))
		if (!isReady && normalized >= 1) {
			return 0.999
		}
		return normalized
	}

	return isReady ? 1 : 0
}

const isRealMediaUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http') || url.startsWith('/') || url.startsWith('./')

const normalizeSourceKind = (value: unknown): ResourceSourceKind => value === 'p2p' ? 'p2p' : 'local'

const appendZeroFillParts = (parts: BlobPart[], byteLength: number): void => {
	let remaining = Math.max(0, Math.floor(byteLength))
	while (remaining > 0) {
		const nextSize = Math.min(remaining, ZERO_FILL_BLOB_CHUNK_BYTES)
		parts.push(ZERO_FILL_BLOB.slice(0, nextSize))
		remaining -= nextSize
	}
}

const toSnapshot = (resourceId: string, attrs: ResourceAttrs, defaultChunkSize: number): ResourceSnapshot => ({
	resourceId,
	kind: attrs.kind,
	mime: attrs.mime,
	duration: Number(attrs.duration) || 0,
	size: typeof attrs.size === 'number' && Number.isFinite(attrs.size) ? attrs.size : undefined,
	chunkSize: Math.max(1, Number(attrs.data?.chunkSize) || defaultChunkSize),
	ownerPeerId: typeof attrs.source?.ownerPeerId === 'string' ? attrs.source.ownerPeerId : null,
	sourceKind: normalizeSourceKind(attrs.source?.kind),
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
	requestedRangesLog: [],
	requestEvents: [],
	pendingRequestIds: new Set<string>(),
	loadedBytes: 0,
	lastTouchedAt: Date.now(),
	tailRequested: false,
	lastWindowKey: '',
	lastWindowRange: null,
	previewUrl: '',
	playbackUrl: '',
	lastPreviewSignature: '',
	lastError: null,
	errorRetryCount: 0,
	retryTimeoutId: null,
	readyRecheckTimeoutId: null,
	status: 'missing',
})

export const createResourceTransferManager = (
	options: CreateResourceTransferManagerOptions,
): ResourceTransferManager => {
	const transfers$ = options.transfers$ ?? createResourceTransferStore()
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
	const pendingOwnerRequests = new Map<string, Array<{ peerKey: string, request: RequestMessage }>>()
	let destroyed = false

	const clearRetryTimeout = (state: RemoteResourceState): void => {
		if (state.retryTimeoutId !== null) {
			window.clearTimeout(state.retryTimeoutId)
			state.retryTimeoutId = null
		}
	}

	const clearReadyRecheckTimeout = (state: RemoteResourceState): void => {
		if (state.readyRecheckTimeoutId !== null) {
			window.clearTimeout(state.readyRecheckTimeoutId)
			state.readyRecheckTimeoutId = null
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
		clearReadyRecheckTimeout(state)
		state.requestedRanges = []
		state.pendingRequestIds.clear()
		state.lastError = null
		state.errorRetryCount = 0
		if (state.status !== 'ready') {
			state.status = state.loadedBytes > 0 ? 'partial' : 'missing'
		}
	}

	const appendRequestEvent = (
		state: RemoteResourceState,
		event: RequestEventEntry,
	): void => {
		state.requestEvents = [...state.requestEvents.slice(-39), event]
	}

	const recomputeRemoteStatus = (state: RemoteResourceState, resourceId: string): void => {
		if (typeof state.size === 'number' && state.loadedBytes >= state.size && state.pendingRequestIds.size === 0) {
			const elapsedSinceLastChunk = Math.max(0, Date.now() - state.lastTouchedAt)
			if (elapsedSinceLastChunk >= READY_CONFIRM_DELAY_MS) {
				clearReadyRecheckTimeout(state)
				state.status = 'ready'
				return
			}

			state.status = state.loadedBytes > 0 ? 'partial' : 'missing'
			if (state.readyRecheckTimeoutId === null) {
				state.readyRecheckTimeoutId = window.setTimeout(() => {
					state.readyRecheckTimeoutId = null
					if (destroyed || !remoteStates.has(resourceId)) {
						return
					}

					recomputeRemoteStatus(state, resourceId)
					updateTransferView(resourceId)
				}, Math.max(1, READY_CONFIRM_DELAY_MS - elapsedSinceLastChunk))
			}
			return
		}

		clearReadyRecheckTimeout(state)
		state.status = state.loadedBytes > 0 ? 'partial' : 'missing'
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

	const sendResourceError = (peerKey: string, resourceId: string, error: unknown): void => {
		sendControl(peerKey, {
			type: 'resource-error',
			resourceId,
			error: error instanceof Error ? error.message : String(error),
		})
	}

	const queuePendingOwnerRequest = (resourceId: string, peerKey: string, request: RequestMessage): void => {
		const pending = pendingOwnerRequests.get(resourceId) ?? []
		pending.push({ peerKey, request })
		pendingOwnerRequests.set(resourceId, pending)
	}

	const flushPendingOwnerRequests = (resourceId: string, resource: LocalResourceEntry): void => {
		const pending = pendingOwnerRequests.get(resourceId)
		if (!pending || pending.length === 0) {
			return
		}

		pendingOwnerRequests.delete(resourceId)
		for (const { peerKey, request } of pending) {
			enqueuePeerServe(peerKey, async () => {
				try {
					await serveLocalBlobRanges(peerKey, resource, request.ranges, request.reason, request.requestId)
				} catch (error) {
					sendResourceError(peerKey, request.resourceId, error)
				}
			})
		}
	}

	const evictRemoteState = (state: RemoteResourceState): void => {
		clearRetryTimeout(state)
		clearReadyRecheckTimeout(state)
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

	const buildSparsePreviewBlob = (state: RemoteResourceState): Blob | null => {
		const totalSize = state.size
		if (typeof totalSize === 'number' && Number.isFinite(totalSize) && totalSize > MAX_SPARSE_PREVIEW_BLOB_BYTES) {
			return buildRemoteBlob(state, false)
		}

		const headRange = getHeadPreviewRange(state.size, state.chunkSize, headBytes)
		const tailRange = state.tailRequested
			? getTailFallbackRange(state.size, state.chunkSize, tailBytes)
			: null
		const selectedRanges = mergeByteRanges([
			...intersectByteRanges(state.loadedRanges, headRange),
			...intersectByteRanges(state.loadedRanges, state.lastWindowRange),
			...intersectByteRanges(state.loadedRanges, tailRange),
		])
		if (selectedRanges.length === 0) {
			return buildRemoteBlob(state, false)
		}

		const preserveOriginalOffsets = selectedRanges.some(([start], index) => index > 0 && start > selectedRanges[index - 1][1])
		const parts: BlobPart[] = []
		let cursor = 0

		for (const [rangeStart, rangeEnd] of selectedRanges) {
			if (preserveOriginalOffsets && rangeStart > cursor) {
				appendZeroFillParts(parts, rangeStart - cursor)
			}

			for (const index of getChunkIndexesForRange([rangeStart, rangeEnd], state.chunkSize)) {
				const chunk = state.chunks.get(index)
				if (!chunk) {
					return null
				}

				const chunkStart = index * state.chunkSize
				const chunkEnd = chunkStart + chunk.byteLength
				const sliceStart = Math.max(rangeStart, chunkStart) - chunkStart
				const sliceEnd = Math.min(rangeEnd, chunkEnd) - chunkStart
				if (sliceEnd > sliceStart) {
					parts.push(chunk.slice(sliceStart, sliceEnd))
				}
			}

			cursor = rangeEnd
		}

		if (
			preserveOriginalOffsets
			&& typeof totalSize === 'number'
			&& Number.isFinite(totalSize)
			&& cursor < totalSize
		) {
			appendZeroFillParts(parts, totalSize - cursor)
		}

		return parts.length > 0 ? new Blob(parts, { type: state.mime }) : null
	}

	const updateTransferView = (resourceId: string): void => {
		const local = localResources.get(resourceId)
		if (local) {
			const totalBytes = local.size ?? local.blob.size
			transfers$.setItem(resourceId, {
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
				requestedRangesLog: [],
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
			transfers$.deleteItem(resourceId)
			return
		}

		const totalBytes = state.size ?? (state.status === 'ready' ? state.loadedBytes : 0)
		const previewUrl = state.playbackUrl || state.previewUrl || (isRealMediaUrl(state.fallbackUrl) ? state.fallbackUrl : '')
		transfers$.setItem(resourceId, {
			resourceId,
			name: state.name,
			kind: state.kind,
			ownerPeerId: state.ownerPeerId,
			availability: 'remote',
			status: state.status === 'missing' && state.requestedRanges.length > 0
				? 'requesting'
				: state.status,
			progress: computeProgress(state.loadedBytes, totalBytes, state.status === 'ready'),
			loadedBytes: state.loadedBytes,
			totalBytes,
			loadedRanges: state.loadedRanges,
			requestedRanges: state.requestedRanges,
			requestedRangesLog: state.requestedRangesLog,
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
		const partialBlob = completeBlob ?? buildSparsePreviewBlob(state) ?? buildRemoteBlob(state, false)
		const signature = `${state.loadedRanges.map(([start, end]) => `${start}-${end}`).join(',')}|window:${state.lastWindowKey}|tail:${state.tailRequested ? '1' : '0'}|${completeBlob ? 'full' : 'partial'}`
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

	const isCurrentTransportGeneration = (peerKey: string, generation: number | undefined): boolean =>
		generation === undefined || getTransport(peerKey)?.generation === generation

	const sendControl = async (peerKey: string, message: ControlMessage, generation?: number): Promise<void> => {
		if (destroyed) {
			return
		}
		if (!isCurrentTransportGeneration(peerKey, generation)) {
			return
		}

		await getTransport(peerKey)?.transport.send(JSON.stringify(message))
	}

	const getRequestPeerKey = (snapshot: ResourceSnapshot): string | null => {
		if (options.getRole() === 'server') {
			const ownerPeerId = snapshot.ownerPeerId && snapshot.ownerPeerId !== options.getPeerId()
				? snapshot.ownerPeerId
				: null
			if (ownerPeerId && getTransport(ownerPeerId)) {
				return ownerPeerId
			}

			// Fallback: in some reconnect / mixed-engine flows transport key may differ from
			// ownerPeerId while still representing the same single remote owner.
			const connectedPeerKeys = Array.from(transports.keys()).filter((peerKey) => peerKey !== SERVER_TRANSPORT_KEY)
			if (connectedPeerKeys.length === 1) {
				return connectedPeerKeys[0]
			}

			return null
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
		const requestId = nextRequestId()

		state.requestedRanges = mergeByteRanges([...state.requestedRanges, ...missingRanges])
		state.requestedRangesLog = mergeByteRanges([...state.requestedRangesLog, ...missingRanges])
		state.pendingRequestIds.add(requestId)
		appendRequestEvent(state, {
			reason,
			ranges: missingRanges,
			requestId,
			phase: 'request',
		})
		updateTransferView(resourceId)
		sendControl(peerKey, {
			type: 'resource-request',
			resourceId,
			ranges: missingRanges,
			reason,
			requestId,
		})
	}

	const planNextRequest = (resourceId: string): void => {
		const state = remoteStates.get(resourceId)
		if (!state) {
			return
		}

		const headRange = getHeadPreviewRange(state.size, state.chunkSize, headBytes)
		const headMissing = headRange ? subtractByteRanges([headRange], state.loadedRanges) : []
		if (headMissing.length > 0) {
			requestRanges(resourceId, headMissing, options.getRole() === 'server' ? 'replication' : 'head')
			return
		}

		if (state.tailRequested) {
			const tailRange = getTailFallbackRange(state.size, state.chunkSize, tailBytes)
			const tailMissing = tailRange ? subtractByteRanges([tailRange], state.loadedRanges) : []
			if (tailMissing.length > 0) {
				requestRanges(resourceId, tailMissing, 'tail')
				return
			}
		}

		if (state.lastWindowRange) {
			const windowMissing = subtractByteRanges([state.lastWindowRange], state.loadedRanges)
			if (windowMissing.length > 0) {
				requestRanges(resourceId, windowMissing, 'window')
				return
			}
		}

		const sequentialRange = getNextSequentialRange({
			totalSize: state.size,
			loadedRanges: state.loadedRanges,
			chunkSize: state.chunkSize,
		})
		if (!sequentialRange) {
			return
		}

		requestRanges(resourceId, [sequentialRange], options.getRole() === 'server' ? 'replication' : 'sequential')
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
		appendRequestEvent(state, {
			reason: meta.reason,
			ranges: [[meta.start, meta.end]],
			requestId: meta.requestId ?? 'legacy',
			phase: 'chunk-meta',
		})
		state.loadedBytes = Array.from(state.chunks.values()).reduce((sum, chunk) => sum + chunk.byteLength, 0)
		state.lastTouchedAt = Date.now()
		recomputeRemoteStatus(state, resourceId)
		state.lastError = null
		clearRetryTimeout(state)
		state.errorRetryCount = 0
		rebuildPreviewUrls(resourceId)
		enforceCacheCap(resourceId)
		planNextRequest(resourceId)
	}

	const handleError = (message: ErrorMessage): void => {
		const state = remoteStates.get(message.resourceId)
		if (!state) {
			return
		}

		clearRetryTimeout(state)
		if (message.requestId) {
			state.pendingRequestIds.delete(message.requestId)
		} else {
			state.pendingRequestIds.clear()
		}
		appendRequestEvent(state, {
			reason: message.reason ?? 'sequential',
			ranges: [],
			requestId: message.requestId ?? 'legacy',
			phase: 'error',
		})
		state.lastError = message.error
		if (state.errorRetryCount >= MAX_ERROR_RETRIES) {
			state.status = 'error'
			updateTransferView(message.resourceId)
			return
		}

		state.errorRetryCount += 1
		recomputeRemoteStatus(state, message.resourceId)
		updateTransferView(message.resourceId)
		state.retryTimeoutId = window.setTimeout(() => {
			state.retryTimeoutId = null
			if (destroyed || !remoteStates.has(message.resourceId)) {
				return
			}

			resetRemoteRequestState(state)
			updateTransferView(message.resourceId)
			planNextRequest(message.resourceId)
		}, ERROR_RETRY_DELAY_MS * 2 ** (state.errorRetryCount - 1))
	}

	const serveLocalBlobRanges = async (
		peerKey: string,
		resource: LocalResourceEntry,
		ranges: ResourceByteRange[],
		reason: TransferReason,
		requestId: string,
		generation?: number,
	): Promise<void> => {
		for (const range of mergeByteRanges(ranges)) {
			for (const index of getChunkIndexesForRange(range, resource.chunkSize)) {
				if (!isCurrentTransportGeneration(peerKey, generation)) {
					return
				}
				const start = index * resource.chunkSize
				const end = typeof resource.size === 'number'
					? Math.min(resource.size, start + resource.chunkSize)
					: start + resource.chunkSize
				if (end <= start) {
					continue
				}
				const buffer = await resource.blob.slice(start, end).arrayBuffer()
				await sendControl(peerKey, {
					type: 'resource-chunk-meta',
					resourceId: resource.resourceId,
					requestId,
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
				}, generation)
				if (!isCurrentTransportGeneration(peerKey, generation)) {
					return
				}
				await getTransport(peerKey)?.transport.send(buffer)
				await wait(chunkSendDelayMs)
			}
		}
		await sendControl(peerKey, {
			type: 'resource-chunk-complete',
			resourceId: resource.resourceId,
			reason,
			requestId,
		}, generation)
	}

	const serveMirroredRanges = async (
		peerKey: string,
		state: RemoteResourceState,
		ranges: ResourceByteRange[],
		reason: TransferReason,
		requestId: string,
		generation?: number,
	): Promise<void> => {
		for (const range of mergeByteRanges(ranges)) {
			for (const index of getChunkIndexesForRange(range, state.chunkSize)) {
				if (!isCurrentTransportGeneration(peerKey, generation)) {
					return
				}
				const buffer = state.chunks.get(index)
				if (!buffer) {
					continue
				}
				const start = index * state.chunkSize
				const end = start + buffer.byteLength
				await sendControl(peerKey, {
					type: 'resource-chunk-meta',
					resourceId: state.resourceId,
					requestId,
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
				}, generation)
				if (!isCurrentTransportGeneration(peerKey, generation)) {
					return
				}
				await getTransport(peerKey)?.transport.send(buffer.slice(0))
				await wait(chunkSendDelayMs)
			}
		}
		await sendControl(peerKey, {
			type: 'resource-chunk-complete',
			resourceId: state.resourceId,
			reason,
			requestId,
		}, generation)
	}

	const handleRequest = (peerKey: string, message: RequestMessage): void => {
		const generation = getTransport(peerKey)?.generation
		const local = localResources.get(message.resourceId)
		if (local) {
			enqueuePeerServe(peerKey, async () => {
				try {
					await serveLocalBlobRanges(peerKey, local, message.ranges, message.reason, message.requestId, generation)
				} catch (error) {
					await sendControl(peerKey, {
						type: 'resource-error',
						resourceId: message.resourceId,
						error: error instanceof Error ? error.message : String(error),
						reason: message.reason,
						requestId: message.requestId,
					}, generation)
				}
			})
			return
		}

		const state = remoteStates.get(message.resourceId)
		if (state && state.ownerPeerId === options.getPeerId()) {
			queuePendingOwnerRequest(message.resourceId, peerKey, message)
			return
		}

		if (!state) {
			sendResourceError(peerKey, message.resourceId, 'Unknown resource')
			return
		}

		enqueuePeerServe(peerKey, async () => {
			try {
				await serveMirroredRanges(peerKey, state, message.ranges, message.reason, message.requestId, generation)
			} catch (error) {
				await sendControl(peerKey, {
					type: 'resource-error',
					resourceId: message.resourceId,
					error: error instanceof Error ? error.message : String(error),
					reason: message.reason,
					requestId: message.requestId,
				}, generation)
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
				if (message.requestId) {
					state.pendingRequestIds.delete(message.requestId)
				} else {
					state.pendingRequestIds.clear()
				}
				appendRequestEvent(state, {
					reason: message.reason,
					ranges: [],
					requestId: message.requestId ?? 'legacy',
					phase: 'chunk-complete',
				})
				state.requestedRanges = []
				recomputeRemoteStatus(state, message.resourceId)
				updateTransferView(message.resourceId)
				planNextRequest(message.resourceId)
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
		const previousGeneration = transports.get(peerKey)?.generation ?? 0
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
			generation: previousGeneration + 1,
		})
	}

	const syncSnapshots = (snapshots: ResourceSnapshot[]): void => {
		if (destroyed) {
			return
		}

		const seen = new Set<string>()
		for (const snapshot of snapshots) {
			seen.add(snapshot.resourceId)
			resourceSnapshots.set(snapshot.resourceId, snapshot)
			if (localResources.has(snapshot.resourceId)) {
				const local = localResources.get(snapshot.resourceId)
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
				updateTransferView(snapshot.resourceId)
				continue
			}

			ensureRemoteState(snapshot)
			updateTransferView(snapshot.resourceId)
			planNextRequest(snapshot.resourceId)
		}

		for (const resourceId of Array.from(resourceSnapshots.keys())) {
			if (seen.has(resourceId) || localResources.has(resourceId)) {
				continue
			}

			resourceSnapshots.delete(resourceId)
			const state = remoteStates.get(resourceId)
			if (state) {
				clearRetryTimeout(state)
				revokeRemoteUrls(state)
				remoteStates.delete(resourceId)
			}
			transfers$.deleteItem(resourceId)
		}
	}

	return {
		transfers$,

		syncResources(resources) {
			syncSnapshots(resources.map((resource) => toSnapshot(resource.resourceId, resource.attrs, defaultChunkSize)))
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
			const local = localResources.get(resourceId)
			remoteStates.delete(resourceId)
			if (local) {
				flushPendingOwnerRequests(resourceId, local)
			}
			updateTransferView(resourceId)
		},

		attachClientTransport(transport) {
			attachTransport(SERVER_TRANSPORT_KEY, transport)
			resetRemoteRequestsForPeer(SERVER_TRANSPORT_KEY)
			for (const [resourceId] of resourceSnapshots) {
				planNextRequest(resourceId)
			}
		},

		attachServerTransport(remotePeerId, transport) {
			attachTransport(remotePeerId, transport)
			resetRemoteRequestsForPeer(remotePeerId)
			for (const [resourceId] of resourceSnapshots) {
				planNextRequest(resourceId)
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

			const transfer = transfers$.getItem(resourceId)
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
			state.lastWindowRange = range
			planNextRequest(resourceId)
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

			state.tailRequested = true
			planNextRequest(resourceId)
		},

		getTransfer(resourceId) {
			return transfers$.getItem(resourceId) ?? null
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
				clearReadyRecheckTimeout(state)
				revokeRemoteUrls(state)
			}
			localResources.clear()
			remoteStates.clear()
			resourceSnapshots.clear()
			pendingOwnerRequests.clear()
		},
	}
}
