import fixWebmDuration from 'fix-webm-duration'
import { ArrayBufferTarget, Muxer } from 'webm-muxer'
import { createAudioExportMixer, encodeMixedAudioTrack, getWebCodecsAudioConfig, mixWebCodecsAudioTrack } from './audioExportMixer'
import type { ExportBackend, ExportDiagnostics, ExportFormat, ExportFrameSample, ExportManifest, ExportProgressEvent, ExportRenderer, ExportRenderResult } from './exportTypes'
import { createExportDiagnostics, filterClipsForRange, getRangeClips, getRangeName, resolveExportRange, type ResolvedExportRange } from './exportRange'
import { createResourceCacheFromPlan, drawPreparedFrameOperations, prepareFrameOperations } from './frameRenderer'
import { compileFrameOperationsFromPlan, type ExportPlan } from './renderPlan'

export type { ExportBackend, ExportDiagnostics, ExportFormat, ExportFrameSample, ExportManifest, ExportProgressEvent, ExportRange, ExportRenderer, ExportRenderRequest, ExportRenderResult } from './exportTypes'
export { shouldSeekRealtimeVideoFrame } from './frameRenderer'

const manifestMimeType = 'application/vnd.minicut.export+json'
const videoMimeType = 'video/webm'
const defaultExportWidth = 1280
const defaultExportHeight = 720

const webmMimeCandidates = [
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm;codecs=vp9',
	'video/webm;codecs=vp8',
	'video/webm',
]

const webCodecsVideoCandidates: Array<{ encoderCodec: string; muxerCodec: 'V_VP8' | 'V_VP9' }> = [
	{ encoderCodec: 'vp8', muxerCodec: 'V_VP8' },
	{ encoderCodec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
]

interface BrowserVideoExportRendererOptions {
	fallbackToManifestOnUnsupported?: boolean
	width?: number
	height?: number
	videoBitsPerSecond?: number
	backgroundColor?: string
}

type WebCodecsRenderAttempt =
	| { blob: Blob; fallbackReason?: undefined }
	| { blob: null; fallbackReason: string }

const sanitizeFileNamePart = (value: string): string =>
	value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export'

const addDiagnosticsToResult = (
	result: ExportRenderResult,
	diagnostics: ExportDiagnostics,
): ExportRenderResult => {
	result.diagnostics = diagnostics
	result.manifest.diagnostics = diagnostics
	if (result.mimeType === manifestMimeType) {
		const blob = renderManifestBlob(result.manifest)
		result.blob = blob
		result.size = blob.size
	}
	return result
}

const getFrameCount = (duration: number, fps: number): number =>
	Math.max(1, Math.ceil(duration * fps))

const getPlanExportDefaults = (plan: ExportPlan): { fps: number; width: number; height: number } => ({
	fps: Number.isFinite(plan.fps) && plan.fps > 0 ? plan.fps : 30,
	width: Number.isFinite(plan.width) && plan.width > 0 ? plan.width : defaultExportWidth,
	height: Number.isFinite(plan.height) && plan.height > 0 ? plan.height : defaultExportHeight,
})

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

const waitForDuration = async (milliseconds: number): Promise<void> =>
	new Promise((resolve) => {
		globalThis.setTimeout(resolve, Math.max(0, milliseconds))
	})

const waitForRecorderData = async (): Promise<void> =>
	new Promise((resolve) => {
		globalThis.requestAnimationFrame?.(() => resolve()) ?? globalThis.setTimeout(resolve, 0)
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

export const getFramePacingDelayMs = (recordingStartedAt: number, frameIndex: number, fps: number, now: number): number => {
	if (!Number.isFinite(recordingStartedAt) || !Number.isFinite(now) || !Number.isFinite(fps) || fps <= 0) {
		return 0
	}
	const targetElapsed = ((frameIndex + 1) / fps) * 1000
	const elapsed = now - recordingStartedAt
	return Math.max(0, targetElapsed - elapsed)
}

const renderWebCodecsVideoBlob = async ({
	plan,
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
	plan: ExportPlan
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
	const audioClipCount = getRangeClips(plan, resolvedRange).filter((clip) => clip.type === 'ef-audio').length
	const audioConfig = audioClipCount > 0
		? await getWebCodecsAudioConfig(2, 128_000)
		: null
	if (audioClipCount > 0 && !audioConfig) {
		return { blob: null, fallbackReason: 'webcodecs-audio-unsupported' }
	}
	const mixedAudioTrack = audioConfig
		? await mixWebCodecsAudioTrack(
			plan,
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

	const resourceCache = createResourceCacheFromPlan(plan)
	try {
		for (let index = 0; index < frameCount; index += 1) {
			const time = start + index / fps
			const operations = filterClipsForRange(
				compileFrameOperationsFromPlan(plan, time),
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

		const projectDefaults = getPlanExportDefaults(request.plan)
		const fps = request.fps ?? projectDefaults.fps
		if (!Number.isFinite(fps) || fps <= 0) {
			throw new Error('Export fps must be positive')
		}

		onProgress?.({ stage: 'queued', progress: 0 })
		const resolvedRange = resolveExportRange(request.plan, request.range)
		const { start, duration } = resolvedRange
		const frameCount = getFrameCount(duration, fps)
		const frames: ExportFrameSample[] = []

		for (let index = 0; index < frameCount; index += 1) {
			const time = start + index / fps
			frames.push({
				index,
				time,
				operations: filterClipsForRange(
					compileFrameOperationsFromPlan(request.plan, time),
					resolvedRange,
				),
			})
			onProgress?.({ stage: 'rendering', progress: (index + 1) / frameCount })
		}

		onProgress?.({ stage: 'finalizing', progress: 1 })
		const manifest: ExportManifest = {
			format,
			projectId: request.plan.projectId,
			range: request.range,
			start,
			duration,
			fps,
			frameCount,
			clips: getRangeClips(request.plan, resolvedRange),
			frames,
		}
		const diagnostics = createExportDiagnostics('manifest', request.plan, resolvedRange)
		manifest.diagnostics = diagnostics
		const blob = renderManifestBlob(manifest)
		const rangeName = getRangeName(request.plan, request.range)
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

			const projectDefaults = getPlanExportDefaults(request.plan)
			const fps = request.fps ?? projectDefaults.fps
			if (!Number.isFinite(fps) || fps <= 0) {
				throw new Error('Export fps must be positive')
			}

			onProgress?.({ stage: 'queued', progress: 0 })
			const resolvedRange = resolveExportRange(request.plan, request.range)
			const { start, duration } = resolvedRange
			const frameCount = getFrameCount(duration, fps)
			const width = options.width ?? projectDefaults.width
			const height = options.height ?? projectDefaults.height
			const backgroundColor = options.backgroundColor ?? '#09090b'
			const videoBitsPerSecond = options.videoBitsPerSecond ?? 4_000_000
			const frames: ExportFrameSample[] = []

			const webCodecsAttempt = await renderWebCodecsVideoBlob({
				plan: request.plan,
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
				const fixedWebCodecsBlob = await fixWebmDuration(webCodecsAttempt.blob, duration * 1000, { logger: false })
				const diagnostics = createExportDiagnostics('webcodecs', request.plan, resolvedRange)
				const manifest: ExportManifest = {
					format,
					projectId: request.plan.projectId,
					range: request.range,
					start,
					duration,
					fps,
					frameCount,
					clips: getRangeClips(request.plan, resolvedRange),
					frames,
					diagnostics,
				}
				const rangeName = getRangeName(request.plan, request.range)
				const result: ExportRenderResult = {
					id: createExportId(),
					fileName: buildFileName(rangeName, format),
					mimeType: videoMimeType,
					blob: fixedWebCodecsBlob,
					size: fixedWebCodecsBlob.size,
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
						createExportDiagnostics('manifest', request.plan, resolvedRange, webCodecsAttempt.fallbackReason),
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

				const audioMixer = await createAudioExportMixer(request.plan, resolvedRange, start, duration)
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
				recorder.addEventListener('error', () => reject(new Error('Export recorder error')))
			})

				const resourceCache = createResourceCacheFromPlan(request.plan)
			recorder.start(Math.max(100, Math.round(1000 / fps)))
			await audioMixer.start()
			const recordingStartedAt = performance.now()

			try {
				for (let index = 0; index < frameCount; index += 1) {
					const time = start + index / fps
					const operations = filterClipsForRange(
						compileFrameOperationsFromPlan(request.plan, time),
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
				projectId: request.plan.projectId,
				range: request.range,
				start,
				duration,
				fps,
				frameCount,
				clips: getRangeClips(request.plan, resolvedRange),
				frames,
			}
			const diagnostics = createExportDiagnostics(
				'media-recorder',
				request.plan,
				resolvedRange,
				webCodecsAttempt.fallbackReason,
			)
			manifest.diagnostics = diagnostics
			const recordedBlob = new Blob(chunks, { type: mimeType })
			const blob = await fixWebmDuration(recordedBlob, duration * 1000, { logger: false })
			const rangeName = getRangeName(request.plan, request.range)
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
