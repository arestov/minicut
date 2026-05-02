import fixWebmDuration from 'fix-webm-duration'
import { ArrayBufferTarget, Muxer } from 'webm-muxer'
import { getProjectEntity, getTrackEnd, getTracks } from '../domain/selectors'
import type { ClipAttrs, Entity, ProjectRegistry, ResourceAttrs } from '../domain/types'
import { compileEditframeClips, compileFrameOperations, type ClipFrameOperation, type EditframeClip } from './renderPlan'

export type ExportFormat = 'json-manifest' | 'video-webm'

export type ExportRange =
	| { type: 'project' }
	| { type: 'clip'; clipId: string }

export interface ExportRenderRequest {
	registry: ProjectRegistry
	projectId: string
	range: ExportRange
	format?: ExportFormat
	fps?: number
}

export interface ExportProgressEvent {
	stage: 'queued' | 'rendering' | 'finalizing' | 'done'
	progress: number
}

export interface ExportFrameSample {
	index: number
	time: number
	operations: ClipFrameOperation[]
}

export type ExportBackend = 'manifest' | 'webcodecs' | 'media-recorder'

export interface ExportDiagnostics {
	backend: ExportBackend
	fallbackReason?: string
	resolvedClipIds: string[]
}

export interface ExportManifest {
	format: ExportFormat
	projectId: string
	range: ExportRange
	start: number
	duration: number
	fps: number
	frameCount: number
	clips: EditframeClip[]
	frames: ExportFrameSample[]
	diagnostics?: ExportDiagnostics
}

export interface ExportRenderResult {
	id: string
	fileName: string
	mimeType: string
	blob: Blob
	size: number
	duration: number
	frameCount: number
	manifest: ExportManifest
	downloadUrl?: string
	diagnostics?: ExportDiagnostics
}

export interface ExportRenderer {
	render(
		request: ExportRenderRequest,
		onProgress?: (event: ExportProgressEvent) => void,
	): Promise<ExportRenderResult>
}

const manifestMimeType = 'application/vnd.minicut.export+json'
const videoMimeType = 'video/webm'
const defaultExportWidth = 1280
const defaultExportHeight = 720

const webmMimeCandidates = [
	'video/webm;codecs=vp9',
	'video/webm;codecs=vp8',
	'video/webm',
]

const webCodecsVideoCandidates: Array<{ encoderCodec: string; muxerCodec: 'V_VP8' | 'V_VP9' }> = [
	{ encoderCodec: 'vp8', muxerCodec: 'V_VP8' },
	{ encoderCodec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
]

const webCodecsAudioCandidates: Array<{ encoderCodec: string; muxerCodec: 'A_OPUS' }> = [
	{ encoderCodec: 'opus', muxerCodec: 'A_OPUS' },
]

interface BrowserVideoExportRendererOptions {
	fallbackToManifestOnUnsupported?: boolean
	width?: number
	height?: number
	videoBitsPerSecond?: number
	backgroundColor?: string
}

interface RenderableResource {
	attrs: ResourceAttrs
	image?: HTMLImageElement
	video?: HTMLVideoElement
	loadPromise?: Promise<void>
}

interface PreparedFrameOperation {
	operation: ClipFrameOperation
	resource: RenderableResource
	sourceWidth: number
	sourceHeight: number
	drawSource?: CanvasImageSource
}

interface PrepareFrameOptions {
	videoSyncMode?: 'seek-each-frame' | 'realtime-playback'
	realtimeSeekTolerance?: number
}

interface AudioExportMixer {
	stream: MediaStream | null
	start(): Promise<void>
	stop(): Promise<void>
}

interface DecodedAudioExportClip {
	buffer: AudioBuffer
	start: number
	duration: number
	trimStart: number
	gain: number
	pan: number
}

interface ElementAudioExportClip {
	element: HTMLMediaElement
	start: number
	duration: number
	trimStart: number
}

interface MixedAudioTrack {
	sampleRate: number
	numberOfChannels: number
	frames: Float32Array[]
}

interface WebCodecsAudioConfig {
	encoderConfig: AudioEncoderConfig
	muxerCodec: 'A_OPUS'
}

interface ResolvedExportRange {
	start: number
	duration: number
	clipIds: Set<string> | null
}

type WebCodecsRenderAttempt =
	| { blob: Blob; fallbackReason?: undefined }
	| { blob: null; fallbackReason: string }

const sanitizeFileNamePart = (value: string): string =>
	value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export'

const getProjectDuration = (registry: ProjectRegistry, projectId: string): number => {
	const project = registry.projects[projectId]
	if (!project) {
		throw new Error(`Unknown project ${projectId}`)
	}

	return getTracks(registry, project).reduce((duration, track) => Math.max(duration, getTrackEnd(registry, track.id)), 0)
}

const getClipEntity = (registry: ProjectRegistry, clipId: string): Entity => {
	const clip = registry.entitiesById[clipId]
	if (!clip || clip.type !== 'clip') {
		throw new Error(`Unknown clip ${clipId}`)
	}

	return clip
}

const getExportBounds = (registry: ProjectRegistry, projectId: string, range: ExportRange): { start: number; duration: number } => {
	if (range.type === 'project') {
		return { start: 0, duration: getProjectDuration(registry, projectId) }
	}

	const attrs = getClipEntity(registry, range.clipId).attrs as unknown as ClipAttrs
	return { start: attrs.start, duration: attrs.duration }
}

const getLinkedClipIds = (registry: ProjectRegistry, clipId: string): string[] => {
	const clip = getClipEntity(registry, clipId)
	const linked = new Set<string>()
	for (const value of [clip.rels.linkedAudioClip, clip.rels.linkedVideoClip]) {
		if (typeof value === 'string') {
			linked.add(value)
		}
	}

	for (const entity of Object.values(registry.entitiesById)) {
		if (entity?.type !== 'clip') {
			continue
		}
		if (entity.rels.linkedAudioClip === clipId || entity.rels.linkedVideoClip === clipId) {
			linked.add(entity.id)
		}
	}

	return Array.from(linked).filter((id) => id !== clipId && registry.entitiesById[id]?.type === 'clip')
}

const resolveExportRange = (
	registry: ProjectRegistry,
	projectId: string,
	range: ExportRange,
): ResolvedExportRange => {
	const bounds = getExportBounds(registry, projectId, range)
	if (range.type === 'project') {
		return { ...bounds, clipIds: null }
	}

	return {
		...bounds,
		clipIds: new Set([range.clipId, ...getLinkedClipIds(registry, range.clipId)]),
	}
}

const filterClipsForRange = (
	operations: ClipFrameOperation[],
	resolvedRange: ResolvedExportRange,
): ClipFrameOperation[] => resolvedRange.clipIds
	? operations.filter((operation) => resolvedRange.clipIds?.has(operation.clipId))
	: operations

const getRangeClips = (registry: ProjectRegistry, projectId: string, resolvedRange: ResolvedExportRange): EditframeClip[] => {
	const clips = compileEditframeClips(registry, projectId)
	if (!resolvedRange.clipIds) {
		return clips
	}

	return clips.filter((clip) => resolvedRange.clipIds?.has(clip.id))
}

const getResolvedClipIds = (
	registry: ProjectRegistry,
	projectId: string,
	resolvedRange: ResolvedExportRange,
): string[] => getRangeClips(registry, projectId, resolvedRange).map((clip) => clip.id)

const createExportDiagnostics = (
	backend: ExportBackend,
	registry: ProjectRegistry,
	projectId: string,
	resolvedRange: ResolvedExportRange,
	fallbackReason?: string,
): ExportDiagnostics => ({
	backend,
	...(fallbackReason ? { fallbackReason } : {}),
	resolvedClipIds: getResolvedClipIds(registry, projectId, resolvedRange),
})

const addDiagnosticsToResult = (
	result: ExportRenderResult,
	diagnostics: ExportDiagnostics,
): ExportRenderResult => {
	result.diagnostics = diagnostics
	result.manifest.diagnostics = diagnostics
	return result
}

const getFrameCount = (duration: number, fps: number): number =>
	Math.max(1, Math.ceil(duration * fps))

const getProjectTitle = (registry: ProjectRegistry, projectId: string): string => {
	const project = registry.projects[projectId]
	if (!project) {
		return 'project'
	}

	return String(getProjectEntity(registry, project).attrs.title ?? 'project')
}

const getRangeName = (registry: ProjectRegistry, projectId: string, range: ExportRange): string =>
	range.type === 'clip'
		? String(getClipEntity(registry, range.clipId).attrs.name ?? 'clip')
		: getProjectTitle(registry, projectId)

const getOperationValue = <Value>(
	operations: ClipFrameOperation['operations'],
	type: ClipFrameOperation['operations'][number]['type'],
	fallback: Value,
): Value => operations.find((operation) => operation.type === type)?.value as Value ?? fallback

const getOperationEffects = (operations: ClipFrameOperation['operations']): string[] =>
	operations
		.filter((operation) => operation.type === 'effect')
		.map((operation) => String(operation.value))

const getEffectFilter = (effect: string): string => {
	if (effect === 'blur') {
		return 'blur(6px)'
	}
	if (effect === 'sharpen') {
		return 'contrast(1.25) saturate(1.125)'
	}
	if (effect === 'tint') {
		return 'sepia(0.35) saturate(1.35)'
	}

	return ''
}

const getWebmMimeType = (): string | null => {
	if (typeof MediaRecorder === 'undefined') {
		return null
	}

	for (const candidate of webmMimeCandidates) {
		if (MediaRecorder.isTypeSupported(candidate)) {
			return candidate
		}
	}

	return null
}

const isVideoExportSupported = (): boolean =>
	typeof document !== 'undefined'
	&& typeof MediaRecorder !== 'undefined'
	&& typeof HTMLCanvasElement !== 'undefined'
	&& typeof HTMLCanvasElement.prototype.captureStream === 'function'
	&& getWebmMimeType() !== null

const isWebCodecsExportSupported = (): boolean =>
	typeof VideoEncoder !== 'undefined'
	&& typeof VideoFrame !== 'undefined'
	&& typeof document !== 'undefined'

const isWebCodecsAudioSupported = (): boolean =>
	typeof AudioEncoder !== 'undefined'
	&& typeof AudioData !== 'undefined'
	&& typeof document !== 'undefined'

const waitForDuration = async (milliseconds: number): Promise<void> =>
	new Promise((resolve) => {
		globalThis.setTimeout(resolve, Math.max(0, milliseconds))
	})

const waitForRecorderData = async (): Promise<void> =>
	new Promise((resolve) => {
		globalThis.requestAnimationFrame?.(() => resolve()) ?? globalThis.setTimeout(resolve, 0)
	})

const getWebCodecsAudioConfig = async (
	numberOfChannels: number,
	bitrate: number,
): Promise<WebCodecsAudioConfig | null> => {
	if (!isWebCodecsAudioSupported()) {
		return null
	}

	const sampleRates = [48_000, 44_100]
	for (const candidate of webCodecsAudioCandidates) {
		for (const sampleRate of sampleRates) {
			const encoderConfig: AudioEncoderConfig = {
				codec: candidate.encoderCodec,
				numberOfChannels,
				sampleRate,
				bitrate,
			}
			try {
				const support = await AudioEncoder.isConfigSupported(encoderConfig)
				if (support.supported) {
					return {
						encoderConfig: support.config ?? encoderConfig,
						muxerCodec: candidate.muxerCodec,
					}
				}
			} catch {
				// Try the next codec candidate.
			}
		}
	}

	return null
}

const clampAudioSample = (sample: number): number => Math.max(-1, Math.min(1, sample))

const resolveStereoSample = (buffer: AudioBuffer, samplePosition: number): [number, number] => {
	const frameIndex = Math.floor(samplePosition)
	const nextIndex = Math.min(buffer.length - 1, frameIndex + 1)
	const interpolation = samplePosition - frameIndex
	const sampleAt = (channel: Float32Array): number =>
		channel[frameIndex] + (channel[nextIndex] - channel[frameIndex]) * interpolation

	if (buffer.numberOfChannels <= 0) {
		return [0, 0]
	}

	if (buffer.numberOfChannels === 1) {
		const mono = sampleAt(buffer.getChannelData(0))
		return [mono, mono]
	}

	return [
		sampleAt(buffer.getChannelData(0)),
		sampleAt(buffer.getChannelData(1)),
	]
}

const getStereoPanGains = (gain: number, pan: number): [number, number] => {
	const normalizedPan = Math.max(-1, Math.min(1, pan))
	const left = gain * (normalizedPan <= 0 ? 1 : 1 - normalizedPan)
	const right = gain * (normalizedPan >= 0 ? 1 : 1 + normalizedPan)
	return [left, right]
}

const mixWebCodecsAudioTrack = async (
	registry: ProjectRegistry,
	projectId: string,
	resolvedRange: ResolvedExportRange,
	exportStart: number,
	exportDuration: number,
	sampleRate: number,
	numberOfChannels: number,
): Promise<MixedAudioTrack | null> => {
	const audioClips = getRangeClips(registry, projectId, resolvedRange).filter((clip) => clip.type === 'ef-audio')
	if (audioClips.length === 0) {
		return null
	}

	const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext
	if (!AudioContextConstructor) {
		return null
	}

	const audioContext = new AudioContextConstructor()
	const totalFrames = Math.max(1, Math.ceil(exportDuration * sampleRate))
	const mixedFrames = Array.from({ length: numberOfChannels }, () => new Float32Array(totalFrames))

	try {
		for (const clip of audioClips) {
			const decodedBuffer = await fetch(clip.source)
				.then((response) => response.arrayBuffer())
				.then((audioData) => audioContext.decodeAudioData(audioData.slice(0)))
				.catch(() => null)
			if (!decodedBuffer) {
				return null
			}

			const clipEnd = clip.start + clip.duration
			const activeStart = Math.max(exportStart, clip.start)
			const activeEnd = Math.min(exportStart + exportDuration, clipEnd)
			if (activeEnd <= activeStart) {
				continue
			}

			const destinationStartFrame = Math.max(0, Math.floor((activeStart - exportStart) * sampleRate))
			const destinationFrameCount = Math.min(
				totalFrames - destinationStartFrame,
				Math.ceil((activeEnd - activeStart) * sampleRate),
			)
			if (destinationFrameCount <= 0) {
				continue
			}

			const sourceOffsetSeconds = clip.trimStart + Math.max(0, exportStart - clip.start)
			const sourceStartFrame = sourceOffsetSeconds * decodedBuffer.sampleRate
			const sourceFrameStep = decodedBuffer.sampleRate / sampleRate
			const [leftGain, rightGain] = getStereoPanGains(
				Math.max(0, Math.min(1.5, Number(clip.gain ?? 1))),
				Math.max(-1, Math.min(1, Number(clip.pan ?? 0))),
			)

			for (let frameOffset = 0; frameOffset < destinationFrameCount; frameOffset += 1) {
				const sourcePosition = sourceStartFrame + frameOffset * sourceFrameStep
				if (!Number.isFinite(sourcePosition) || sourcePosition >= decodedBuffer.length - 1) {
					break
				}
				const [leftSample, rightSample] = resolveStereoSample(decodedBuffer, sourcePosition)
				const destinationIndex = destinationStartFrame + frameOffset
				mixedFrames[0][destinationIndex] += leftSample * leftGain
				if (numberOfChannels > 1) {
					mixedFrames[1][destinationIndex] += rightSample * rightGain
				}
			}
		}

		for (let channel = 0; channel < mixedFrames.length; channel += 1) {
			const channelData = mixedFrames[channel]
			for (let index = 0; index < channelData.length; index += 1) {
				channelData[index] = clampAudioSample(channelData[index])
			}
		}

		return {
			sampleRate,
			numberOfChannels,
			frames: mixedFrames,
		}
	} finally {
		await audioContext.close().catch(() => undefined)
	}
}

const waitForMediaMetadata = (element: HTMLMediaElement): Promise<void> =>
	new Promise((resolve) => {
		if (Number.isFinite(element.duration) && element.duration > 0) {
			resolve()
			return
		}

		const finish = (): void => {
			element.removeEventListener('loadedmetadata', finish)
			element.removeEventListener('error', finish)
			resolve()
		}
		element.addEventListener('loadedmetadata', finish, { once: true })
		element.addEventListener('error', finish, { once: true })
		element.load()
	})

const getWebCodecsConfig = async (
	width: number,
	height: number,
	fps: number,
	bitrate: number,
): Promise<{ encoderConfig: VideoEncoderConfig; muxerCodec: 'V_VP8' | 'V_VP9' } | null> => {
	if (!isWebCodecsExportSupported()) {
		return null
	}

	for (const candidate of webCodecsVideoCandidates) {
		const encoderConfig: VideoEncoderConfig = {
			codec: candidate.encoderCodec,
			width,
			height,
			bitrate,
			framerate: fps,
		}
		try {
			const support = await VideoEncoder.isConfigSupported(encoderConfig)
			if (support.supported) {
				return { encoderConfig: support.config ?? encoderConfig, muxerCodec: candidate.muxerCodec }
			}
		} catch {
			// Try the next codec candidate.
		}
	}

	return null
}

const clampTimeToDuration = (time: number, duration: number): number => {
	if (!Number.isFinite(duration) || duration <= 0) {
		return Math.max(0, time)
	}

	return Math.min(Math.max(0, time), Math.max(0, duration - 0.001))
}

export const shouldSeekRealtimeVideoFrame = (
	currentTime: number,
	targetTime: number,
	tolerance: number,
): boolean =>
	!Number.isFinite(currentTime)
	|| !Number.isFinite(targetTime)
	|| Math.abs(currentTime - targetTime) > tolerance

export const getFramePacingDelayMs = (recordingStartedAt: number, frameIndex: number, fps: number, now: number): number => {
	if (!Number.isFinite(recordingStartedAt) || !Number.isFinite(now) || !Number.isFinite(fps) || fps <= 0) {
		return 0
	}
	const targetElapsed = ((frameIndex + 1) / fps) * 1000
	const elapsed = now - recordingStartedAt
	return Math.max(0, targetElapsed - elapsed)
}

const loadImageResource = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error(`Failed to load image resource ${url}`))
		image.src = url
	})

const loadVideoResource = (url: string): Promise<HTMLVideoElement> =>
	new Promise((resolve, reject) => {
		const video = document.createElement('video')
		video.muted = true
		video.playsInline = true
		video.preload = 'auto'
		video.onloadedmetadata = () => resolve(video)
		video.onerror = () => reject(new Error(`Failed to load video resource ${url}`))
		video.src = url
		video.load()
	})

const seekVideo = (video: HTMLVideoElement, targetTime: number): Promise<void> =>
	new Promise((resolve) => {
		const finish = (): void => {
			video.removeEventListener('seeked', onSeeked)
			globalThis.clearTimeout(timeoutId)
			resolve()
		}

		const onSeeked = (): void => {
			finish()
		}

		const timeoutId = globalThis.setTimeout(finish, 250)
		video.addEventListener('seeked', onSeeked, { once: true })

		try {
			const duration = Number.isFinite(video.duration) ? video.duration : 0
			video.currentTime = clampTimeToDuration(targetTime, duration)
		} catch {
			finish()
		}
	})

const createResourceCache = (registry: ProjectRegistry): Map<string, RenderableResource> => {
	const cache = new Map<string, RenderableResource>()
	for (const entityId of Object.keys(registry.entitiesById)) {
		const entity = registry.entitiesById[entityId]
		if (!entity || entity.type !== 'resource') {
			continue
		}

		cache.set(entityId, {
			attrs: entity.attrs as unknown as ResourceAttrs,
		})
	}

	return cache
}

const ensureRenderableResource = async (
	resource: RenderableResource,
	kind: ClipFrameOperation['resourceKind'],
): Promise<void> => {
	if (kind === 'image') {
		if (resource.image || resource.loadPromise) {
			await resource.loadPromise
			return
		}

		resource.loadPromise = loadImageResource(resource.attrs.url).then((image) => {
			resource.image = image
		})
		await resource.loadPromise
		return
	}

	if (kind === 'video') {
		if (resource.video || resource.loadPromise) {
			await resource.loadPromise
			return
		}

		resource.loadPromise = loadVideoResource(resource.attrs.url).then((video) => {
			resource.video = video
		})
		await resource.loadPromise
	}
}

const prepareFrameOperations = async (
	operations: ClipFrameOperation[],
	resourceCache: Map<string, RenderableResource>,
	width: number,
	height: number,
	options: PrepareFrameOptions = {},
): Promise<PreparedFrameOperation[]> => {
	const prepared: PreparedFrameOperation[] = []
	const videoSyncMode = options.videoSyncMode ?? 'seek-each-frame'
	const realtimeSeekTolerance = options.realtimeSeekTolerance ?? 0.15

	for (const operation of operations) {
		const resource = resourceCache.get(operation.resourceId)
		if (!resource) {
			continue
		}
		if (operation.resourceKind === 'audio') {
			prepared.push({
				operation,
				resource,
				sourceWidth: width,
				sourceHeight: height,
			})
			continue
		}

		await ensureRenderableResource(resource, operation.resourceKind)
		if (operation.resourceKind === 'image' && resource.image) {
			prepared.push({
				operation,
				resource,
				drawSource: resource.image,
				sourceWidth: resource.image.naturalWidth || Number(resource.attrs.width) || width,
				sourceHeight: resource.image.naturalHeight || Number(resource.attrs.height) || height,
			})
			continue
		}

		if (operation.resourceKind === 'video' && resource.video) {
			if (videoSyncMode === 'seek-each-frame') {
				await seekVideo(resource.video, operation.sourceTime)
			} else {
				if (shouldSeekRealtimeVideoFrame(resource.video.currentTime, operation.sourceTime, realtimeSeekTolerance)) {
					await seekVideo(resource.video, operation.sourceTime)
				}
				void resource.video.play().catch(() => undefined)
			}
			prepared.push({
				operation,
				resource,
				drawSource: resource.video,
				sourceWidth: resource.video.videoWidth || Number(resource.attrs.width) || width,
				sourceHeight: resource.video.videoHeight || Number(resource.attrs.height) || height,
			})
			continue
		}

		prepared.push({
			operation,
			resource,
			sourceWidth: width,
			sourceHeight: height,
		})
	}

	return prepared
}

const drawPreparedFrameOperations = (
	context: CanvasRenderingContext2D,
	preparedOperations: PreparedFrameOperation[],
	width: number,
	height: number,
	backgroundColor: string,
): void => {
	context.save()
	context.clearRect(0, 0, width, height)
	context.fillStyle = backgroundColor
	context.fillRect(0, 0, width, height)
	context.restore()

	for (const { operation, resource, sourceWidth, sourceHeight, drawSource } of preparedOperations) {
		if (operation.resourceKind === 'audio') {
			continue
		}

		const transform = getOperationValue<{ x: number; y: number; scale: number; rotation: number }>(
			operation.operations,
			'transform',
			{ x: 0, y: 0, scale: 1, rotation: 0 },
		)
		const opacity = Math.max(0, Math.min(1, Number(getOperationValue(operation.operations, 'opacity', 1)) || 0))
		const filters = getOperationEffects(operation.operations)
			.map((effect) => getEffectFilter(effect))
			.filter(Boolean)
			.join(' ')

		context.save()
		context.globalAlpha = opacity
		context.filter = filters || 'none'
		context.translate(width / 2 + transform.x, height / 2 + transform.y)
		context.rotate((transform.rotation * Math.PI) / 180)
		context.scale(transform.scale, transform.scale)

		if (drawSource) {
			const fitScale = Math.min(width / sourceWidth, height / sourceHeight)
			const drawWidth = sourceWidth * fitScale
			const drawHeight = sourceHeight * fitScale
			context.drawImage(drawSource, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
		} else {
			context.fillStyle = '#e4e4e7'
			context.fillRect(-220, -40, 440, 80)
			context.fillStyle = '#18181b'
			context.font = '600 24px Segoe UI, sans-serif'
			context.textAlign = 'center'
			context.fillText(operation.resourceKind.toUpperCase(), 0, 8)
		}

		context.restore()
	}
}

const encodeMixedAudioTrack = async (
	muxer: Muxer<ArrayBufferTarget>,
	audioConfig: WebCodecsAudioConfig,
	mixedTrack: MixedAudioTrack,
): Promise<void> => {
	const encoder = new AudioEncoder({
		output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
		error: (error) => {
			throw error
		},
	})
	encoder.configure(audioConfig.encoderConfig)

	const framesPerChunk = 960
	try {
		const { numberOfChannels, sampleRate, frames } = mixedTrack
		const totalFrames = frames[0]?.length ?? 0
		for (let offset = 0; offset < totalFrames; offset += framesPerChunk) {
			const frameCount = Math.min(framesPerChunk, totalFrames - offset)
			const interleaved = new Float32Array(frameCount * numberOfChannels)
			for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
				for (let channel = 0; channel < numberOfChannels; channel += 1) {
					interleaved[frameIndex * numberOfChannels + channel] = frames[channel][offset + frameIndex] ?? 0
				}
			}

			const audioData = new AudioData({
				format: 'f32',
				sampleRate,
				numberOfFrames: frameCount,
				numberOfChannels,
				timestamp: Math.round((offset / sampleRate) * 1_000_000),
				data: new Uint8Array(interleaved.buffer),
			})
			encoder.encode(audioData)
			audioData.close()
		}

		await encoder.flush()
	} finally {
		encoder.close()
	}
}

const createAudioExportMixer = async (
	registry: ProjectRegistry,
	projectId: string,
	resolvedRange: ResolvedExportRange,
	exportStart: number,
	exportDuration: number,
): Promise<AudioExportMixer> => {
	const audioClips = getRangeClips(registry, projectId, resolvedRange).filter((clip) => clip.type === 'ef-audio')
	const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext
	if (audioClips.length === 0 || !AudioContextConstructor) {
		return { stream: null, start: async () => undefined, stop: async () => undefined }
	}

	const audioContext = new AudioContextConstructor()
	const destination = audioContext.createMediaStreamDestination()
	const decodedClips: DecodedAudioExportClip[] = []
	const sources: AudioBufferSourceNode[] = []
	const elementClips: ElementAudioExportClip[] = []
	const elementTimers: Array<ReturnType<typeof globalThis.setTimeout>> = []

	for (const clip of audioClips) {
		const buffer = await fetch(clip.source)
			.then((response) => response.arrayBuffer())
			.then((audioData) => audioContext.decodeAudioData(audioData.slice(0)))
			.catch(() => null)
		const gainValue = Math.max(0, Math.min(1.5, Number(clip.gain ?? 1)))
		const panValue = Math.max(-1, Math.min(1, Number(clip.pan ?? 0)))
		if (buffer) {
			decodedClips.push({
				buffer,
				start: clip.start,
				duration: clip.duration,
				trimStart: clip.trimStart,
				gain: gainValue,
				pan: panValue,
			})
			continue
		}

		const element = document.createElement('audio')
		element.preload = 'auto'
		element.src = clip.source
		await waitForMediaMetadata(element)
		const source = audioContext.createMediaElementSource(element)
		const gain = audioContext.createGain()
		gain.gain.value = gainValue
		const stereoPanner = 'createStereoPanner' in audioContext
			? audioContext.createStereoPanner()
			: null
		if (stereoPanner) {
			stereoPanner.pan.value = panValue
			source.connect(gain).connect(stereoPanner).connect(destination)
		} else {
			source.connect(gain).connect(destination)
		}
		elementClips.push({
			element,
			start: clip.start,
			duration: clip.duration,
			trimStart: clip.trimStart,
		})
	}
	if (decodedClips.length === 0 && elementClips.length === 0) {
		await audioContext.close().catch(() => undefined)
		return { stream: null, start: async () => undefined, stop: async () => undefined }
	}

	return {
		stream: destination.stream,
		async start() {
			await audioContext.resume()
			const baseTime = audioContext.currentTime
			for (const clip of decodedClips) {
				const clipEnd = clip.start + clip.duration
				const activeStart = Math.max(exportStart, clip.start)
				const activeEnd = Math.min(exportStart + exportDuration, clipEnd)
				if (activeEnd <= activeStart) {
					continue
				}

				const delay = Math.max(0, clip.start - exportStart)
				const offset = Math.max(0, exportStart - clip.start)
				const bufferOffset = clip.trimStart + offset
				const activeDuration = Math.min(activeEnd - activeStart, Math.max(0, clip.buffer.duration - bufferOffset))
				if (activeDuration <= 0) {
					continue
				}

				const source = audioContext.createBufferSource()
				source.buffer = clip.buffer
				const gain = audioContext.createGain()
				gain.gain.value = clip.gain
				const stereoPanner = 'createStereoPanner' in audioContext
					? audioContext.createStereoPanner()
					: null
				if (stereoPanner) {
					stereoPanner.pan.value = clip.pan
					source.connect(gain).connect(stereoPanner).connect(destination)
				} else {
					source.connect(gain).connect(destination)
				}
				source.start(baseTime + delay, bufferOffset, activeDuration)
				sources.push(source)
			}

			for (const clip of elementClips) {
				const clipEnd = clip.start + clip.duration
				const activeStart = Math.max(exportStart, clip.start)
				const activeEnd = Math.min(exportStart + exportDuration, clipEnd)
				if (activeEnd <= activeStart) {
					continue
				}

				const delayMs = Math.max(0, (clip.start - exportStart) * 1000)
				const stopMs = Math.max(0, (activeEnd - exportStart) * 1000)
				const offset = Math.max(0, exportStart - clip.start)
				elementTimers.push(globalThis.setTimeout(() => {
					try {
						clip.element.currentTime = clip.trimStart + offset
					} catch {
						// Best-effort: metadata might still lag for some browsers.
					}
					void clip.element.play().catch(() => undefined)
				}, delayMs))
				elementTimers.push(globalThis.setTimeout(() => clip.element.pause(), stopMs))
			}
		},
		async stop() {
			for (const timer of elementTimers) {
				globalThis.clearTimeout(timer)
			}
			for (const source of sources) {
				try {
					source.stop()
				} catch {
					// Buffer sources can already be stopped by their scheduled duration.
				}
			}
			for (const clip of elementClips) {
				clip.element.pause()
				clip.element.removeAttribute('src')
				clip.element.load()
			}
			await audioContext.close().catch(() => undefined)
		},
	}
}

const renderWebCodecsVideoBlob = async ({
	registry,
	projectId,
	resolvedRange,
	start,
	fps,
	frameCount,
	width,
	height,
	backgroundColor,
	videoBitsPerSecond,
	onProgress,
	onFrame,
}: {
	registry: ProjectRegistry
	projectId: string
	resolvedRange: ResolvedExportRange
	start: number
	fps: number
	frameCount: number
	width: number
	height: number
	backgroundColor: string
	videoBitsPerSecond: number
	onProgress?: (event: ExportProgressEvent) => void
	onFrame: (frame: ExportFrameSample) => void
}): Promise<WebCodecsRenderAttempt> => {
	const config = await getWebCodecsConfig(width, height, fps, videoBitsPerSecond)
	if (!config) {
		return { blob: null, fallbackReason: 'webcodecs-video-unsupported' }
	}
	const audioClipCount = getRangeClips(registry, projectId, resolvedRange).filter((clip) => clip.type === 'ef-audio').length
	const audioConfig = audioClipCount > 0
		? await getWebCodecsAudioConfig(2, 128_000)
		: null
	if (audioClipCount > 0 && !audioConfig) {
		return { blob: null, fallbackReason: 'webcodecs-audio-unsupported' }
	}
	const mixedAudioTrack = audioConfig
		? await mixWebCodecsAudioTrack(
			registry,
			projectId,
			resolvedRange,
			start,
			frameCount / fps,
			audioConfig.encoderConfig.sampleRate,
			audioConfig.encoderConfig.numberOfChannels,
		)
		: null
	if (audioClipCount > 0 && audioConfig && !mixedAudioTrack) {
		return { blob: null, fallbackReason: 'webcodecs-audio-mix-failed' }
	}

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext('2d')
	if (!context) {
		throw new Error('Unable to acquire export canvas context')
	}

	const target = new ArrayBufferTarget()
	const muxer = new Muxer({
		target,
		video: {
			codec: config.muxerCodec,
			width,
			height,
			frameRate: fps,
		},
		...(audioConfig && mixedAudioTrack
			? {
				audio: {
					codec: audioConfig.muxerCodec,
					numberOfChannels: mixedAudioTrack.numberOfChannels,
					sampleRate: mixedAudioTrack.sampleRate,
				},
			}
			: {}),
		firstTimestampBehavior: 'strict',
	})
	const encoder = new VideoEncoder({
		output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
		error: (error) => {
			throw error
		},
	})
	encoder.configure(config.encoderConfig)

	const resourceCache = createResourceCache(registry)
	try {
		for (let index = 0; index < frameCount; index += 1) {
			const time = start + index / fps
			const operations = filterClipsForRange(
				compileFrameOperations(registry, projectId, time),
				resolvedRange,
			)
			const preparedOperations = await prepareFrameOperations(operations, resourceCache, width, height)
			const timestamp = Math.round((index / fps) * 1_000_000)
			const duration = Math.round((1 / fps) * 1_000_000)
			const frameSample = { index, time, operations }
			onFrame(frameSample)
			drawPreparedFrameOperations(context, preparedOperations, width, height, backgroundColor)
			const frame = new VideoFrame(canvas, { timestamp, duration })
			encoder.encode(frame, { keyFrame: index % Math.max(1, Math.round(fps)) === 0 })
			frame.close()
			onProgress?.({ stage: 'rendering', progress: (index + 1) / frameCount })
		}

		await encoder.flush()
		if (audioConfig && mixedAudioTrack) {
			await encodeMixedAudioTrack(muxer, audioConfig, mixedAudioTrack)
		}
		muxer.finalize()
		return { blob: new Blob([target.buffer], { type: videoMimeType }) }
	} finally {
		encoder.close()
		for (const resource of resourceCache.values()) {
			if (resource.video) {
				resource.video.pause()
				resource.video.removeAttribute('src')
				resource.video.load()
			}
		}
	}
}

const buildFileName = (
	rangeName: string,
	format: ExportFormat,
): string => `${sanitizeFileNamePart(rangeName)}${format === 'video-webm' ? '.webm' : '.minicut-export.json'}`

const renderManifestBlob = (manifest: ExportManifest): Blob =>
	new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: manifestMimeType })

const createExportId = (): string => {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID()
	}

	return `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const createManifestExportRenderer = (): ExportRenderer => ({
	async render(request, onProgress) {
		const format = request.format ?? 'json-manifest'
		if (format !== 'json-manifest') {
			throw new Error(`Unsupported export format ${format}`)
		}

		const fps = request.fps ?? 30
		if (!Number.isFinite(fps) || fps <= 0) {
			throw new Error('Export fps must be positive')
		}

		if (!request.registry.projects[request.projectId]) {
			throw new Error(`Unknown project ${request.projectId}`)
		}

		onProgress?.({ stage: 'queued', progress: 0 })
		const { start, duration } = getExportBounds(request.registry, request.projectId, request.range)
		const resolvedRange = resolveExportRange(request.registry, request.projectId, request.range)
		const frameCount = getFrameCount(duration, fps)
		const frames: ExportFrameSample[] = []

		for (let index = 0; index < frameCount; index += 1) {
			const time = start + index / fps
			frames.push({
				index,
				time,
				operations: filterClipsForRange(
					compileFrameOperations(request.registry, request.projectId, time),
					resolvedRange,
				),
			})
			onProgress?.({ stage: 'rendering', progress: (index + 1) / frameCount })
		}

		onProgress?.({ stage: 'finalizing', progress: 1 })
		const manifest: ExportManifest = {
			format,
			projectId: request.projectId,
			range: request.range,
			start,
			duration,
			fps,
			frameCount,
			clips: getRangeClips(request.registry, request.projectId, resolvedRange),
			frames,
		}
		const diagnostics = createExportDiagnostics('manifest', request.registry, request.projectId, resolvedRange)
		manifest.diagnostics = diagnostics
		const blob = renderManifestBlob(manifest)
		const rangeName = getRangeName(request.registry, request.projectId, request.range)
		const result: ExportRenderResult = {
			id: createExportId(),
			fileName: buildFileName(rangeName, format),
			mimeType: manifestMimeType,
			blob,
			size: blob.size,
			duration,
			frameCount,
			manifest,
			diagnostics,
		}
		onProgress?.({ stage: 'done', progress: 1 })

		return result
	},
})

export const createBrowserVideoExportRenderer = (
	options: BrowserVideoExportRendererOptions = {},
): ExportRenderer => {
	const fallbackToManifestOnUnsupported = options.fallbackToManifestOnUnsupported ?? true
	const fallbackRenderer = createManifestExportRenderer()

	return {
		async render(request, onProgress) {
			const format = request.format ?? 'video-webm'
			if (format === 'json-manifest') {
				return fallbackRenderer.render(request, onProgress)
			}

			if (format !== 'video-webm') {
				throw new Error(`Unsupported export format ${format}`)
			}

			const fps = request.fps ?? 30
			if (!Number.isFinite(fps) || fps <= 0) {
				throw new Error('Export fps must be positive')
			}

			if (!request.registry.projects[request.projectId]) {
				throw new Error(`Unknown project ${request.projectId}`)
			}

			onProgress?.({ stage: 'queued', progress: 0 })
			const resolvedRange = resolveExportRange(request.registry, request.projectId, request.range)
			const { start, duration } = resolvedRange
			const frameCount = getFrameCount(duration, fps)
			const width = options.width ?? defaultExportWidth
			const height = options.height ?? defaultExportHeight
			const backgroundColor = options.backgroundColor ?? '#09090b'
			const videoBitsPerSecond = options.videoBitsPerSecond ?? 4_000_000
			const frames: ExportFrameSample[] = []

			const webCodecsAttempt = await renderWebCodecsVideoBlob({
				registry: request.registry,
				projectId: request.projectId,
				resolvedRange,
				start,
				fps,
				frameCount,
				width,
				height,
				backgroundColor,
				videoBitsPerSecond,
				onProgress,
				onFrame: (frame) => frames.push(frame),
			})

			if (webCodecsAttempt.blob) {
				onProgress?.({ stage: 'finalizing', progress: 1 })
				const diagnostics = createExportDiagnostics('webcodecs', request.registry, request.projectId, resolvedRange)
				const manifest: ExportManifest = {
					format,
					projectId: request.projectId,
					range: request.range,
					start,
					duration,
					fps,
					frameCount,
					clips: getRangeClips(request.registry, request.projectId, resolvedRange),
					frames,
					diagnostics,
				}
				const rangeName = getRangeName(request.registry, request.projectId, request.range)
				const result: ExportRenderResult = {
					id: createExportId(),
					fileName: buildFileName(rangeName, format),
					mimeType: videoMimeType,
					blob: webCodecsAttempt.blob,
					size: webCodecsAttempt.blob.size,
					duration,
					frameCount,
					manifest,
					diagnostics,
				}
				onProgress?.({ stage: 'done', progress: 1 })

				return result
			}

			if (!isVideoExportSupported()) {
				if (fallbackToManifestOnUnsupported) {
					const result = await fallbackRenderer.render({ ...request, format: 'json-manifest' }, onProgress)
					return addDiagnosticsToResult(
						result,
						createExportDiagnostics('manifest', request.registry, request.projectId, resolvedRange, webCodecsAttempt.fallbackReason),
					)
				}

				throw new Error('Video export is not supported in this environment')
			}

			const canvas = document.createElement('canvas')
			canvas.width = width
			canvas.height = height
			const context = canvas.getContext('2d')
			if (!context) {
				throw new Error('Unable to acquire export canvas context')
			}

			const audioMixer = await createAudioExportMixer(request.registry, request.projectId, resolvedRange, start, duration)
			let stream = canvas.captureStream(0)
			let videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
			if (typeof videoTrack?.requestFrame !== 'function') {
				for (const track of stream.getVideoTracks()) {
					track.stop()
				}
				stream = canvas.captureStream(fps)
				videoTrack = undefined
			}
			if (audioMixer.stream) {
				for (const audioTrack of audioMixer.stream.getAudioTracks()) {
					stream.addTrack(audioTrack)
				}
			}
			const mimeType = getWebmMimeType() ?? videoMimeType
			const recorder = new MediaRecorder(stream, {
				mimeType,
				videoBitsPerSecond,
			})
			const chunks: BlobPart[] = []
			const stopPromise = new Promise<void>((resolve, reject) => {
				recorder.addEventListener('dataavailable', (event) => {
					if (event.data.size > 0) {
						chunks.push(event.data)
					}
				})
				recorder.addEventListener('stop', () => resolve())
				recorder.addEventListener('error', () => reject(recorder.error ?? new Error('Export recorder error')))
			})

			const resourceCache = createResourceCache(request.registry)
			recorder.start(Math.max(100, Math.round(1000 / fps)))
			await audioMixer.start()
			const recordingStartedAt = performance.now()

			try {
				for (let index = 0; index < frameCount; index += 1) {
					const time = start + index / fps
					const operations = filterClipsForRange(
						compileFrameOperations(request.registry, request.projectId, time),
						resolvedRange,
					)
					const preparedOperations = await prepareFrameOperations(
						operations,
						resourceCache,
						width,
						height,
						{
							videoSyncMode: 'realtime-playback',
							realtimeSeekTolerance: Math.max(0.08, 1 / fps),
						},
					)
					frames.push({ index, time, operations })
					drawPreparedFrameOperations(context, preparedOperations, width, height, backgroundColor)
					videoTrack?.requestFrame()
					onProgress?.({ stage: 'rendering', progress: (index + 1) / frameCount })
					await waitForDuration(getFramePacingDelayMs(recordingStartedAt, index, fps, performance.now()))
					await waitForRecorderData()
				}

				onProgress?.({ stage: 'finalizing', progress: 1 })
				recorder.stop()
				await stopPromise
			} finally {
				await audioMixer.stop()
				for (const track of stream.getTracks()) {
					track.stop()
				}
				for (const resource of resourceCache.values()) {
					if (resource.video) {
						resource.video.pause()
						resource.video.removeAttribute('src')
						resource.video.load()
					}
				}
			}

			const manifest: ExportManifest = {
				format,
				projectId: request.projectId,
				range: request.range,
				start,
				duration,
				fps,
				frameCount,
				clips: getRangeClips(request.registry, request.projectId, resolvedRange),
				frames,
			}
			const diagnostics = createExportDiagnostics(
				'media-recorder',
				request.registry,
				request.projectId,
				resolvedRange,
				webCodecsAttempt.fallbackReason,
			)
			manifest.diagnostics = diagnostics
			const recordedBlob = new Blob(chunks, { type: mimeType })
			const blob = await fixWebmDuration(recordedBlob, duration * 1000, { logger: false })
			const rangeName = getRangeName(request.registry, request.projectId, request.range)
			const result: ExportRenderResult = {
				id: createExportId(),
				fileName: buildFileName(rangeName, format),
				mimeType,
				blob,
				size: blob.size,
				duration,
				frameCount,
				manifest,
				diagnostics,
			}
			onProgress?.({ stage: 'done', progress: 1 })

			return result
		},
	}
}
