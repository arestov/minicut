import { useEffect, useMemo, useRef, useState } from 'react'
import type { RenderedClip, PreviewFrame } from '../read-model/previewReadModel'
import { createPreviewScopeData, type PreviewScopeData, type RgbaSampleFrame, type ScopeDensityFrame } from '../render/colorScopes'
import { drawScopeDensityCanvas, drawVectorscopePoints, parseScopeColor, type ScopeRgbColor } from '../render/colorScopeCanvas'
import type { PreviewMediaElementRegistry } from './mediaElementRegistry'

export type ScopeMode = 'waveform' | 'rgb-parade' | 'vectorscope'

type ScopeProfileEvent =
	| { type: 'sample-request'; clipId: string; resourceKind: string; cursor: number; localTime: number }
	| { type: 'sample-resolved'; clipId: string; resourceKind: string; durationMs: number; sampled: boolean; source: ScopeSampleSource }
	| { type: 'compute'; mode: ScopeMode; durationMs: number; clipCount: number; sampleCount: number }
	| { type: 'canvas-draw'; label: string; durationMs: number }

type ScopeSampleSource = 'preview-video' | 'image-cache' | 'video-sampler'
type ScopeSamplingStrategy = 'displayed-preview-frame' | 'state-frame'

declare global {
	interface Window {
		__MINICUT_SCOPE_PROFILE__?: {
			events: Array<ScopeProfileEvent & { at: number }>
			record?: (event: ScopeProfileEvent & { at: number }) => void
		}
	}
}

const recordScopeProfileEvent = (event: ScopeProfileEvent): void => {
	if (typeof window === 'undefined') {
		return
	}

	const profile = window.__MINICUT_SCOPE_PROFILE__
	if (!profile) {
		return
	}

	const entry = { ...event, at: performance.now() }
	profile.events.push(entry)
	profile.record?.(entry)
}

const scopeSampleWidth = 192
const scopeSampleHeight = 108
const scopeSampleRateFps = 12
const scopeSampleIntervalSeconds = 1 / scopeSampleRateFps
const stateFramePreviewToleranceSeconds = 0.05
const getScopeSamplingStrategy = (): ScopeSamplingStrategy => 'displayed-preview-frame'
const waveformTintColor = parseScopeColor('#f4f4f5')
const redParadeTintColor = parseScopeColor('#ef4444')
const greenParadeTintColor = parseScopeColor('#22c55e')
const blueParadeTintColor = parseScopeColor('#3b82f6')
const vectorscopeTintColor = parseScopeColor('#a1a1aa')

const imageSampleFrameCache = new Map<string, Promise<RgbaSampleFrame | null>>()

const getScopeSampleLocalTime = (clip: RenderedClip, cursor: number): number => Math.max(0, cursor - clip.start + clip.inPoint)

const quantizeScopeLocalTime = (time: number): number =>
	Math.round(time / scopeSampleIntervalSeconds) * scopeSampleIntervalSeconds

const getVideoSamplerKey = (clip: RenderedClip): string => `${clip.id}:${clip.resourceUrl}`

const getScopeSampleKey = (clips: RenderedClip[], cursor: number): string =>
	clips.map((clip) => `${clip.id}:${clip.resourceUrl}:${Math.round(quantizeScopeLocalTime(getScopeSampleLocalTime(clip, cursor)) * 1000)}`).join('|')

const getScopeClipKey = (clips: RenderedClip[]): string =>
	clips.map((clip) => [
		clip.id,
		clip.resourceId,
		clip.resourceKind,
		clip.resourceUrl,
		clip.color,
		clip.opacity.toFixed(3),
		clip.filters.join(','),
	].join(':')).join('|')

const drawElementToSampleFrame = (
	element: CanvasImageSource,
	width = scopeSampleWidth,
	height = scopeSampleHeight,
): RgbaSampleFrame | null => {
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext('2d', { willReadFrequently: true })
	if (!context) {
		return null
	}

	context.drawImage(element, 0, 0, width, height)
	const image = context.getImageData(0, 0, width, height)
	return { width, height, data: image.data }
}

const tryReadPreviewVideoSampleFrame = (
	clip: RenderedClip,
	mediaElementRegistry: PreviewMediaElementRegistry,
	stateLocalTime: number,
): RgbaSampleFrame | null => {
	const video = mediaElementRegistry.getVideo(clip.id)
	if (!video || video.seeking || video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
		return null
	}

	const stateDrift = Math.abs(video.currentTime - stateLocalTime)
	if (getScopeSamplingStrategy() === 'state-frame' && stateDrift > stateFramePreviewToleranceSeconds) {
		return null
	}

	try {
		// The color inspector should describe the frame the user is actually looking at.
		// During playback the app state is the scheduling intent, while HTMLVideoElement.currentTime
		// is the decoded frame reality. So the default strategy samples the visible preview video
		// read-only, even if it is slightly behind/ahead of state. We never seek this element here;
		// when an exact state frame is required or the preview video is not ready, the private
		// VideoScopeSampler below performs the seek on its own hidden element instead.
		return drawElementToSampleFrame(video)
	} catch {
		return null
	}
}

const loadImageSampleFrame = (url: string): Promise<RgbaSampleFrame | null> => new Promise((resolve) => {
	const image = new Image()
	image.crossOrigin = 'anonymous'
	image.onload = () => {
		try {
			resolve(drawElementToSampleFrame(image))
		} catch {
			resolve(null)
		}
	}
	image.onerror = () => resolve(null)
	image.src = url
})

const getCachedImageSampleFrame = (url: string): Promise<RgbaSampleFrame | null> => {
	const cached = imageSampleFrameCache.get(url)
	if (cached) {
		return cached
	}

	const promise = loadImageSampleFrame(url)
	imageSampleFrameCache.set(url, promise)
	return promise
}

class VideoScopeSampler {
	private readonly video: HTMLVideoElement
	private readonly readyPromise: Promise<void>
	private requestToken = 0
	private disposed = false

	constructor(url: string) {
		this.video = document.createElement('video')
		this.video.crossOrigin = 'anonymous'
		this.video.muted = true
		this.video.playsInline = true
		this.video.preload = 'auto'
		this.video.src = url
		this.readyPromise = new Promise((resolve) => {
			const finish = () => resolve()
			this.video.addEventListener('loadeddata', finish, { once: true })
			this.video.addEventListener('error', finish, { once: true })
		})
	}

	dispose(): void {
		this.disposed = true
		this.requestToken += 1
		this.video.removeAttribute('src')
		this.video.load()
	}

	async sample(localTime: number): Promise<RgbaSampleFrame | null> {
		const requestToken = this.requestToken + 1
		this.requestToken = requestToken
		await this.readyPromise
		if (this.disposed || requestToken !== this.requestToken || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
			return null
		}

		const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0
		const targetTime = duration > 0 ? Math.min(Math.max(0, localTime), Math.max(0, duration - 0.05)) : Math.max(0, localTime)
		if (Math.abs(this.video.currentTime - targetTime) <= 0.025 && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
			return drawElementToSampleFrame(this.video)
		}

		return new Promise((resolve) => {
			let done = false
			const finish = () => {
				if (done) {
					return
				}
				done = true
				window.clearTimeout(timeoutId)
				this.video.removeEventListener('seeked', finish)
				this.video.removeEventListener('error', fail)
				if (this.disposed || requestToken !== this.requestToken) {
					resolve(null)
					return
				}
				try {
					resolve(drawElementToSampleFrame(this.video))
				} catch {
					resolve(null)
				}
			}
			const fail = () => {
				if (done) {
					return
				}
				done = true
				window.clearTimeout(timeoutId)
				this.video.removeEventListener('seeked', finish)
				this.video.removeEventListener('error', fail)
				resolve(null)
			}
			const timeoutId = window.setTimeout(fail, 900)
			this.video.addEventListener('seeked', finish)
			this.video.addEventListener('error', fail)
			try {
				this.video.currentTime = targetTime
			} catch {
				fail()
			}
		})
	}
}

const usePreviewScopeSamples = (
	clips: RenderedClip[],
	cursor: number,
	mediaElementRegistry: PreviewMediaElementRegistry,
): Record<string, RgbaSampleFrame | undefined> => {
	const [samples, setSamples] = useState<Record<string, RgbaSampleFrame | undefined>>({})
	const videoSamplersRef = useRef(new Map<string, VideoScopeSampler>())
	const sampleKey = useMemo(() => getScopeSampleKey(clips, cursor), [clips, cursor])

	useEffect(() => () => {
		for (const sampler of videoSamplersRef.current.values()) {
			sampler.dispose()
		}
		videoSamplersRef.current.clear()
	}, [])

	useEffect(() => {
		if (typeof document === 'undefined' || navigator.userAgent.includes('jsdom')) {
			return
		}

		let cancelled = false
		const activeClipIds = new Set(clips.map((clip) => clip.id))
		const activeVideoSamplerKeys = new Set(clips
			.filter((clip) => clip.resourceKind === 'video' && clip.resourceUrl)
			.map(getVideoSamplerKey))

		setSamples((current) => {
			let changed = false
			const next: Record<string, RgbaSampleFrame | undefined> = {}
			for (const clip of clips) {
				next[clip.id] = current[clip.id]
			}
			for (const clipId of Object.keys(current)) {
				if (!activeClipIds.has(clipId)) {
					changed = true
				}
			}
			return changed ? next : current
		})

		for (const [samplerKey, sampler] of videoSamplersRef.current) {
			if (!activeVideoSamplerKeys.has(samplerKey)) {
				sampler.dispose()
				videoSamplersRef.current.delete(samplerKey)
			}
		}

		for (const clip of clips) {
			if (!clip.resourceUrl || clip.resourceKind === 'text' || clip.resourceKind === 'audio') {
				setSamples((current) => current[clip.id] === undefined ? current : { ...current, [clip.id]: undefined })
				continue
			}

			const startedAt = performance.now()
			const localTime = getScopeSampleLocalTime(clip, cursor)
			recordScopeProfileEvent({
				type: 'sample-request',
				clipId: clip.id,
				resourceKind: clip.resourceKind,
				cursor,
				localTime,
			})

			const previewVideoSample = clip.resourceKind === 'video'
				? tryReadPreviewVideoSampleFrame(clip, mediaElementRegistry, localTime)
				: null
			if (previewVideoSample) {
				recordScopeProfileEvent({
					type: 'sample-resolved',
					clipId: clip.id,
					resourceKind: clip.resourceKind,
					durationMs: performance.now() - startedAt,
					sampled: true,
					source: 'preview-video',
				})
				setSamples((current) => current[clip.id] === previewVideoSample ? current : { ...current, [clip.id]: previewVideoSample })
				continue
			}

			const sampleSource: ScopeSampleSource = clip.resourceKind === 'image' ? 'image-cache' : 'video-sampler'
			const samplePromise = clip.resourceKind === 'image'
				? getCachedImageSampleFrame(clip.resourceUrl)
				: (() => {
					const samplerKey = getVideoSamplerKey(clip)
					let sampler = videoSamplersRef.current.get(samplerKey)
					if (!sampler) {
						sampler = new VideoScopeSampler(clip.resourceUrl)
						videoSamplersRef.current.set(samplerKey, sampler)
					}
					return sampler.sample(localTime)
				})()

			void samplePromise.then((frame) => {
				recordScopeProfileEvent({
					type: 'sample-resolved',
					clipId: clip.id,
					resourceKind: clip.resourceKind,
					durationMs: performance.now() - startedAt,
					sampled: frame !== null,
					source: sampleSource,
				})
				if (cancelled || frame === null) {
					return
				}
				setSamples((current) => current[clip.id] === frame ? current : { ...current, [clip.id]: frame })
			})
		}
		return () => {
			cancelled = true
		}
	}, [sampleKey, mediaElementRegistry])

	return samples
}

const ScopeDensityCanvas = ({ frame, tint, label, className = '', vectorscopePoints = [] }: {
	frame: ScopeDensityFrame
	tint: ScopeRgbColor
	label: string
	className?: string
	vectorscopePoints?: PreviewScopeData['vectorscope']['points']
}) => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)

	useEffect(() => {
		if (navigator.userAgent.includes('jsdom')) {
			return
		}

		const canvas = canvasRef.current
		const context = canvas?.getContext('2d')
		if (!canvas || !context) {
			return
		}

		canvas.width = frame.width
		canvas.height = frame.height
		const startedAt = performance.now()
		drawScopeDensityCanvas(context, frame, tint)
		if (vectorscopePoints.length > 0) {
			drawVectorscopePoints(context, vectorscopePoints, frame.width, frame.height)
		}
		recordScopeProfileEvent({ type: 'canvas-draw', label, durationMs: performance.now() - startedAt })
	}, [frame, tint, vectorscopePoints])

	return (
		<canvas
			ref={canvasRef}
			className={`ve-scope-density ${className}`}
			aria-label={label}
			role="img"
			width={frame.width}
			height={frame.height}
		/>
	)
}

const WaveformScopeSection = ({ scopes }: { scopes: PreviewScopeData }) => (
	<ScopeDensityCanvas frame={scopes.waveform} tint={waveformTintColor} label="Waveform luma density" />
)

const RgbParadeScopeSection = ({ scopes }: { scopes: PreviewScopeData }) => (
	<div className="ve-scopes__parade">
		<ScopeDensityCanvas frame={{ width: scopes.rgbParade.width, height: scopes.rgbParade.height, cells: scopes.rgbParade.red }} tint={redParadeTintColor} label="Red parade density" />
		<ScopeDensityCanvas frame={{ width: scopes.rgbParade.width, height: scopes.rgbParade.height, cells: scopes.rgbParade.green }} tint={greenParadeTintColor} label="Green parade density" />
		<ScopeDensityCanvas frame={{ width: scopes.rgbParade.width, height: scopes.rgbParade.height, cells: scopes.rgbParade.blue }} tint={blueParadeTintColor} label="Blue parade density" />
	</div>
)

const VectorscopeSection = ({ scopes }: { scopes: PreviewScopeData }) => (
	<div className="ve-scopes__vectors" aria-label="Vectorscope points">
		<ScopeDensityCanvas frame={scopes.vectorscope} tint={vectorscopeTintColor} label="Vectorscope chroma density" className="ve-scope-density--vectors" vectorscopePoints={scopes.vectorscope.points} />
	</div>
)

export const ColorScopesPanel = ({
	frame,
	mode,
	onModeChange,
	resolveResourceUrl,
	mediaElementRegistry,
}: {
	frame: PreviewFrame
	mode: ScopeMode
	onModeChange: (mode: ScopeMode) => void
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string
	mediaElementRegistry: PreviewMediaElementRegistry
}) => {
	const resolvedClips = useMemo(
		() => frame.visualRenderedClips.map((clip) => ({
			...clip,
			resourceUrl: clip.resourceId ? resolveResourceUrl(clip.resourceId, clip.resourceUrl) : clip.resourceUrl,
		})),
		[frame.visualRenderedClips, resolveResourceUrl],
	)
	const sampleFrames = usePreviewScopeSamples(resolvedClips, frame.cursor, mediaElementRegistry)
	const scopeClipKey = useMemo(() => getScopeClipKey(resolvedClips), [resolvedClips])
	const scopes: PreviewScopeData = useMemo(() => {
		const startedAt = performance.now()
		const nextScopes = createPreviewScopeData(resolvedClips, sampleFrames, {
			includeWaveform: mode === 'waveform',
			includeRgbParade: mode === 'rgb-parade',
			includeVectorscope: mode === 'vectorscope',
			includeVectorscopePoints: mode === 'vectorscope',
		})
		recordScopeProfileEvent({
			type: 'compute',
			mode,
			durationMs: performance.now() - startedAt,
			clipCount: nextScopes.clipCount,
			sampleCount: nextScopes.sampleCount,
		})
		return nextScopes
	}, [scopeClipKey, sampleFrames, mode])
	const isEmpty = scopes.clipCount === 0

	return (
		<div className="ve-scopes" aria-label="Color scopes">
			<div className="ve-scopes__header">
				<strong>Scopes</strong>
				<div className="ve-scopes__tabs" role="tablist" aria-label="Scope mode">
					<button type="button" role="tab" aria-selected={mode === 'waveform'} className={mode === 'waveform' ? 'is-active' : ''} onClick={() => onModeChange('waveform')}>Waveform</button>
					<button type="button" role="tab" aria-selected={mode === 'rgb-parade'} className={mode === 'rgb-parade' ? 'is-active' : ''} onClick={() => onModeChange('rgb-parade')}>RGB Parade</button>
					<button type="button" role="tab" aria-selected={mode === 'vectorscope'} className={mode === 'vectorscope' ? 'is-active' : ''} onClick={() => onModeChange('vectorscope')}>Vectorscope</button>
				</div>
			</div>
			<div className="ve-scopes__plot" data-scope-mode={mode}>
				{isEmpty ? <span className="ve-scopes__empty">No visual clip at cursor</span> : null}
				{!isEmpty && mode === 'waveform' ? <WaveformScopeSection scopes={scopes} /> : null}
				{!isEmpty && mode === 'rgb-parade' ? <RgbParadeScopeSection scopes={scopes} /> : null}
				{!isEmpty && mode === 'vectorscope' ? <VectorscopeSection scopes={scopes} /> : null}
			</div>
		</div>
	)
}
