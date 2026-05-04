import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import type { PreviewFrame, PreviewStructure, RenderedClip } from '../legend/derivedTimeline'
// Keep Vite's worker query import explicit.
//
// Why this is intentionally verbose:
// - Vite rewrites `?worker` imports into a JS worker asset URL at build time.
// - If we hide worker resolution behind dynamic URL composition, Vite may stop transforming it,
//   and the browser can end up requesting a raw `.ts` file with a wrong MIME type.
// - This direct import guarantees the emitted asset is JavaScript (previewCanvasWorker-*.js).
import PreviewCanvasWorker from './previewCanvasWorker?worker'

const offscreenWorkers = new WeakMap<HTMLCanvasElement, Worker>()
const pausedSeekToleranceSeconds = 0.04
const playingSeekToleranceSeconds = 0.18
const pausedSeekIntervalMs = 45
const playingSeekIntervalMs = 250

interface MediaSeekState {
	lastSeekAt: number
	wasPlaying: boolean
}

interface RendererStageProps {
	structure: PreviewStructure
	frame: PreviewFrame
	isPlaying: boolean
	compareMode?: 'off' | 'split'
	onClipMediaError?: (resourceId: string) => void
}

interface PreviewCanvasClipSource {
	name: string
	color: string
	kind: string
	filters: string[]
	text: PreviewStructure['clipSources'][number]['text']
	start: number
	duration: number
	fadeIn: number
	fadeOut: number
	opacity: PreviewStructure['clipSources'][number]['opacity']
}

interface CanvasSize {
	width: number
	height: number
}

const fallbackCanvasSize: CanvasSize = { width: 640, height: 360 }

const getCanvasSize = (canvas: HTMLCanvasElement): CanvasSize => ({
	width: canvas.clientWidth || fallbackCanvasSize.width,
	height: canvas.clientHeight || fallbackCanvasSize.height,
})

const getCanvasClipSources = (structure: PreviewStructure): PreviewCanvasClipSource[] =>
	structure.clipSources.map((clip) => ({
		name: clip.name,
		color: clip.color,
		kind: clip.resourceKind,
		filters: clip.filters,
		text: clip.text,
		start: clip.start,
		duration: clip.duration,
		fadeIn: clip.fadeIn,
		fadeOut: clip.fadeOut,
		opacity: clip.opacity,
	}))

const isRealMediaUrl = (url: string): boolean =>
	url.startsWith('blob:') ||
	url.startsWith('/') ||
	url.startsWith('./') ||
	url.startsWith('http') ||
	url.startsWith('data:')

const drawFallbackPreview = (
	canvas: HTMLCanvasElement,
	size: CanvasSize,
	cursor: number,
	clips: RenderedClip[],
): void => {
	const context = canvas.getContext('2d')
	if (!context) {
		return
	}

	const { width, height } = size
	canvas.width = width
	canvas.height = height
	context.clearRect(0, 0, width, height)
	context.fillStyle = '#27272a'
	context.fillRect(0, 0, width, height)
	context.fillStyle = 'rgba(37, 99, 235, 0.2)'
	context.fillRect(0, 0, width, height)
	context.strokeStyle = 'rgba(244,244,245,0.28)'
	context.setLineDash([6, 6])
	context.strokeRect(10, 10, width - 20, height - 20)
	context.setLineDash([])
	context.fillStyle = '#f4f4f5'
	context.font = '600 14px Inter, Segoe UI, sans-serif'
	context.fillText(`Cursor ${cursor.toFixed(1)}s`, 22, 32)

	if (clips.length === 0) {
		return
	}

	clips.forEach((clip, index) => {
		const y = 54 + index * 28
		context.globalAlpha = Math.max(0.2, clip.opacity)
		context.fillStyle = clip.color
		context.fillRect(22, y, Math.min(width - 44, 260), 20)
		context.globalAlpha = 1
		context.fillStyle = '#18181b'
		context.font = '600 12px Inter, Segoe UI, sans-serif'
		context.fillText(`${clip.resourceKind}: ${clip.text?.content ?? clip.name}`, 30, y + 14)
	})
}

const getTextAlignItems = (align: NonNullable<RenderedClip['text']>['style']['align']): 'flex-start' | 'center' | 'flex-end' => {
	if (align === 'left') {
		return 'flex-start'
	}
	if (align === 'right') {
		return 'flex-end'
	}
	return 'center'
}

const renderTextClip = (clip: RenderedClip) => {
	if (!clip.text) {
		return null
	}

	return (
		<div
			className="ve-renderer__text-box"
			style={{
				width: `${clip.text.box.width}px`,
				minHeight: `${clip.text.box.height}px`,
				backgroundColor: clip.text.style.backgroundColor ?? 'transparent',
				alignItems: getTextAlignItems(clip.text.style.align),
			}}
		>
			<span
				className="ve-renderer__text-content"
				style={{
					color: clip.text.style.color,
					fontFamily: clip.text.style.fontFamily,
					fontSize: `${clip.text.style.fontSize}px`,
					fontWeight: clip.text.style.fontWeight,
					lineHeight: clip.text.style.lineHeight,
					letterSpacing: `${clip.text.style.letterSpacing}px`,
					textAlign: clip.text.style.align,
				}}
			>
				{clip.text.content}
			</span>
		</div>
	)
}

const getClipLocalMediaTime = (clip: RenderedClip, cursor: number): number =>
	Math.max(0, clip.inPoint + cursor - clip.start)

const getLayerStyle = (clip: RenderedClip, filters: string[]): CSSProperties => ({
	opacity: clip.opacity,
	filter: filters.join(' '),
	borderColor: clip.color,
	boxShadow: `0 0 0 2px ${clip.color}, 0 20px 45px rgba(0, 0, 0, 0.3)`,
	transform: `translate(${clip.transform.x}px, ${clip.transform.y}px) scale(${clip.transform.scale}) rotate(${clip.transform.rotation}deg)`,
})

const syncMediaPlayback = (
	element: HTMLMediaElement,
	shouldPlay: boolean,
): void => {
	if (shouldPlay) {
		void element.play().catch(() => undefined)
		return
	}

	element.pause()
}

const seekMediaElement = (
	element: HTMLMediaElement,
	localTime: number,
	tolerance = pausedSeekToleranceSeconds,
): boolean => {
	if (
		Number.isFinite(localTime) &&
		Math.abs(element.currentTime - localTime) > tolerance
	) {
		try {
			element.currentTime = localTime
			return true
		} catch {
			// Some browsers reject seeking before metadata is ready; metadata handlers retry.
		}
	}

	return false
}

const usePreviewCanvasRenderer = (
	structure: PreviewStructure,
	frame: PreviewFrame,
): { canvasRef: MutableRefObject<HTMLCanvasElement | null>; renderMode: 'offscreen' | 'fallback' } => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const workerRef = useRef<Worker | null>(null)
	const canvasSizeRef = useRef<CanvasSize>(fallbackCanvasSize)
	const [renderMode, setRenderMode] = useState<'offscreen' | 'fallback'>('fallback')

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) {
			return
		}

		canvasSizeRef.current = getCanvasSize(canvas)

		if (navigator.userAgent.includes('jsdom')) {
			return
		}

		const existingWorker = offscreenWorkers.get(canvas)
		if (existingWorker) {
			workerRef.current = existingWorker
			setRenderMode('offscreen')
		} else if (!workerRef.current && 'transferControlToOffscreen' in canvas) {
			const offscreen = canvas.transferControlToOffscreen()
			const worker = new PreviewCanvasWorker()
			worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
			offscreenWorkers.set(canvas, worker)
			workerRef.current = worker
			setRenderMode('offscreen')
		}
	}, [])

	useEffect(() => {
		workerRef.current?.postMessage({
			type: 'setScene',
			clips: getCanvasClipSources(structure),
		})
	}, [structure])

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) {
			return
		}

		if (workerRef.current) {
			const { width, height } = canvasSizeRef.current
			workerRef.current.postMessage({
				type: 'render',
				width,
				height,
				cursor: frame.cursor,
			})
			return
		}

		if (navigator.userAgent.includes('jsdom')) {
			return
		}

		setRenderMode('fallback')
		drawFallbackPreview(canvas, canvasSizeRef.current, frame.cursor, frame.renderedClips)
	}, [frame])

	return { canvasRef, renderMode }
}

const useMediaElementSync = (
	mediaElementsRef: MutableRefObject<Map<string, HTMLMediaElement>>,
	mediaSeekStateRef: MutableRefObject<Map<string, MediaSeekState>>,
	frame: PreviewFrame,
	isPlaying: boolean,
): void => {
	useEffect(() => {
		const now = performance.now()
		for (const clip of frame.renderedClips) {
			if (clip.resourceKind !== 'video' && clip.resourceKind !== 'audio') {
				continue
			}

			const element = mediaElementsRef.current.get(clip.id)
			if (!element) {
				continue
			}

			const localTime = getClipLocalMediaTime(clip, frame.cursor)
			const seekState = mediaSeekStateRef.current.get(clip.id) ?? {
				lastSeekAt: 0,
				wasPlaying: false,
			}
			const playbackStateChanged = seekState.wasPlaying !== isPlaying
			const tolerance = isPlaying
				? playingSeekToleranceSeconds
				: pausedSeekToleranceSeconds
			const interval = isPlaying ? playingSeekIntervalMs : pausedSeekIntervalMs
			const canSeek =
				playbackStateChanged || now - seekState.lastSeekAt >= interval

			if (canSeek && seekMediaElement(element, localTime, tolerance)) {
				seekState.lastSeekAt = now
			}
			seekState.wasPlaying = isPlaying
			mediaSeekStateRef.current.set(clip.id, seekState)
			element.volume = Math.min(1, Math.max(0, clip.audio.gain))
			// Pan remains export-only until preview audio is routed through an AudioContext/StereoPannerNode.
			element.dataset.pan = String(clip.audio.pan)
			if (playbackStateChanged) {
				syncMediaPlayback(element, isPlaying)
			}
		}
	}, [frame, isPlaying, mediaElementsRef, mediaSeekStateRef])
}

const VisualClipLayer = ({
	clip,
	cursor,
	filters,
	mediaElementsRef,
	mediaSeekStateRef,
	onClipMediaError,
}: {
	clip: RenderedClip
	cursor: number
	filters: string[]
	mediaElementsRef?: MutableRefObject<Map<string, HTMLMediaElement>>
	mediaSeekStateRef?: MutableRefObject<Map<string, MediaSeekState>>
	onClipMediaError?: (resourceId: string) => void
}) => {
	const hasMedia = isRealMediaUrl(clip.resourceUrl)
	const handleVideoRef = useCallback((element: HTMLVideoElement | null) => {
		if (!mediaElementsRef) {
			return
		}
		if (element) {
			mediaElementsRef.current.set(clip.id, element)
			return
		}
		mediaElementsRef.current.delete(clip.id)
		mediaSeekStateRef?.current.delete(clip.id)
	}, [clip.id, mediaElementsRef, mediaSeekStateRef])

	return (
		<div
			className={`ve-renderer__layer ve-renderer__layer--${clip.resourceKind}`}
			style={getLayerStyle(clip, filters)}
		>
			{hasMedia && clip.resourceKind === 'image' ? (
				<img src={clip.resourceUrl} alt={clip.resourceName} />
			) : null}
			{hasMedia && clip.resourceKind === 'video' ? (
				<video
					ref={mediaElementsRef ? handleVideoRef : undefined}
					src={clip.resourceUrl}
					muted
					playsInline
					preload="metadata"
					onLoadedMetadata={(event) =>
						seekMediaElement(
							event.currentTarget,
							getClipLocalMediaTime(clip, cursor),
						)
					}
					onError={() => {
						if (clip.resourceId) {
							onClipMediaError?.(clip.resourceId)
						}
					}}
				/>
			) : null}
			{clip.resourceKind === 'text' ? renderTextClip(clip) : null}
			{!hasMedia && clip.resourceKind !== 'text' ? (
				<>
					<strong>{clip.name}</strong>
					<span>{clip.resourceName}</span>
				</>
			) : null}
		</div>
	)
}

export const RendererStage = ({ structure, frame, isPlaying, compareMode = 'off', onClipMediaError }: RendererStageProps) => {
	const { canvasRef, renderMode } = usePreviewCanvasRenderer(structure, frame)
	const mediaElementsRef = useRef(new Map<string, HTMLMediaElement>())
	const mediaSeekStateRef = useRef(new Map<string, MediaSeekState>())
	useMediaElementSync(mediaElementsRef, mediaSeekStateRef, frame, isPlaying)

	const isSplitCompare = compareMode === 'split' && frame.visualRenderedClips.length > 0

	return (
		<div className="ve-renderer" aria-label="Renderer stage">
			<div className="ve-renderer__safe-area">
				<canvas
					ref={canvasRef}
					className="ve-renderer__canvas"
					aria-label="Offscreen preview canvas"
					data-render-mode={renderMode}
				/>
				{frame.visualRenderedClips.length === 0 ? (
					<div className="ve-renderer__empty">No frame at cursor</div>
				) : (
					frame.visualRenderedClips.map((clip) => (
						<VisualClipLayer
							key={clip.id}
							clip={clip}
							cursor={frame.cursor}
							filters={clip.filters}
							mediaElementsRef={mediaElementsRef}
							mediaSeekStateRef={mediaSeekStateRef}
							onClipMediaError={onClipMediaError}
						/>
					))
				)}
				{isSplitCompare ? (
					<div className="ve-renderer__compare" aria-label="Split compare preview">
						<div className="ve-renderer__compare-before" aria-hidden="true">
							{frame.visualRenderedClips.map((clip) => (
								<VisualClipLayer
									key={`before-${clip.id}`}
									clip={clip}
									cursor={frame.cursor}
									filters={[]}
									onClipMediaError={onClipMediaError}
								/>
							))}
						</div>
						<div className="ve-renderer__compare-divider" />
						<span className="ve-renderer__compare-label ve-renderer__compare-label--before">Before</span>
						<span className="ve-renderer__compare-label ve-renderer__compare-label--after">After</span>
					</div>
				) : null}
				<div className="ve-renderer__audio-elements" aria-hidden="true">
					{frame.audioRenderedClips.map((clip) =>
						isRealMediaUrl(clip.resourceUrl) ? (
							<audio
								key={clip.id}
								ref={(element) => {
									if (element) {
										mediaElementsRef.current.set(clip.id, element)
										return
									}
									mediaElementsRef.current.delete(clip.id)
									mediaSeekStateRef.current.delete(clip.id)
								}}
								src={clip.resourceUrl}
								data-resource-name={clip.resourceName}
								data-gain={clip.audio.gain}
								data-pan={clip.audio.pan}
								preload="metadata"
								onLoadedMetadata={(event) =>
									seekMediaElement(
										event.currentTarget,
										getClipLocalMediaTime(clip, frame.cursor),
									)
								}
								onError={() => {
									if (clip.resourceId) {
										onClipMediaError?.(clip.resourceId)
									}
								}}
							/>
						) : null,
					)}
				</div>
			</div>
		</div>
	)
}
