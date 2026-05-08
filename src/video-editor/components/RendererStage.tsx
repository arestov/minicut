import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import type { PreviewFrame, PreviewStructure, RenderedClip } from '../read-model/previewReadModel'
import { mergeColorProgramCssFilters, type ColorProgram } from '../render/colorProgram'
import { compilePreviewLayerOperation, compilePreviewRenderPlan, getPreviewOperationValue, type PreviewLayerOperation } from '../render/previewRenderPlan'
// Keep Vite's worker query import explicit.
//
// Why this is intentionally verbose:
// - Vite rewrites `?worker` imports into a JS worker asset URL at build time.
// - If we hide worker resolution behind dynamic URL composition, Vite may stop transforming it,
//   and the browser can end up requesting a raw `.ts` file with a wrong MIME type.
// - This direct import guarantees the emitted asset is JavaScript (previewCanvasWorker-*.js).
import PreviewCanvasWorker from './previewCanvasWorker?worker'
import type { PreviewMediaElementRegistry } from './mediaElementRegistry'

const offscreenWorkers = new WeakMap<HTMLCanvasElement, Worker>()
const pausedSeekToleranceSeconds = 0.04
const playingSeekToleranceSeconds = 0.18
const pausedSeekIntervalMs = 45
const playingSeekIntervalMs = 250

interface MediaSeekState {
	lastSeekAt: number
	wasPlaying: boolean
}

interface PreviewLayerViewModel {
	clip: RenderedClip
	layerIndex: number
	operation: PreviewLayerOperation
	beforeOperation: PreviewLayerOperation
}

interface RendererStageProps {
	structure: PreviewStructure
	frame: PreviewFrame
	isPlaying: boolean
	mediaElementRegistry: PreviewMediaElementRegistry
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

const getCanvasClipSources = (structure: PreviewStructure, frame: PreviewFrame): PreviewCanvasClipSource[] => {
	const sourceClips = structure.clipSources.length > 0
		? structure.clipSources
		: frame.renderedClips.map((clip) => ({
			name: clip.name,
			color: clip.color,
			resourceKind: clip.resourceKind,
			filters: clip.filters,
			text: clip.text,
			start: clip.start,
			duration: Number.MAX_SAFE_INTEGER,
			fadeIn: 0,
			fadeOut: 0,
			opacity: { value: clip.opacity },
		}))

	return sourceClips.map((clip) => ({
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
}

const getCanvasSceneKey = (clips: readonly PreviewCanvasClipSource[]): string =>
	clips.map((clip) => [
		clip.name,
		clip.kind,
		clip.color,
		clip.start,
		clip.duration,
		clip.fadeIn,
		clip.fadeOut,
		clip.opacity.value,
		clip.filters.join(','),
		clip.text?.content ?? '',
	].join('\u001f')).join('\u001e')

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
	transform: `translate(${clip.transform.x}px, ${clip.transform.y}px) scale(${clip.transform.scale}) rotate(${clip.transform.rotation}deg)`,
})

const drawContainedVideoFrame = (canvas: HTMLCanvasElement, video: HTMLVideoElement): boolean => {
	if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
		return false
	}

	const rect = canvas.getBoundingClientRect()
	const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || fallbackCanvasSize.width))
	const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || fallbackCanvasSize.height))
	if (canvas.width !== width) {
		canvas.width = width
	}
	if (canvas.height !== height) {
		canvas.height = height
	}

	const context = canvas.getContext('2d')
	if (!context) {
		return false
	}

	const scale = Math.min(width / video.videoWidth, height / video.videoHeight)
	const drawWidth = video.videoWidth * scale
	const drawHeight = video.videoHeight * scale
	const drawX = (width - drawWidth) / 2
	const drawY = (height - drawHeight) / 2
	context.clearRect(0, 0, width, height)
	context.fillStyle = '#09090b'
	context.fillRect(0, 0, width, height)
	context.drawImage(video, drawX, drawY, drawWidth, drawHeight)
	return true
}

const withoutEffectOperations = (operation: PreviewLayerOperation): PreviewLayerOperation => ({
	...operation,
	operations: operation.operations.filter((item) => item.type !== 'effect'),
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
	const canvasSceneClips = getCanvasClipSources(structure, frame)
	const canvasSceneKey = getCanvasSceneKey(canvasSceneClips)

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
			clips: canvasSceneClips,
		})
	}, [canvasSceneKey])

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
	}, [frame.cursor])

	return { canvasRef, renderMode }
}

const useMediaElementSync = (
	mediaElementRegistry: PreviewMediaElementRegistry,
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

			const element = mediaElementRegistry.get(clip.id)?.element
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
	}, [frame, isPlaying, mediaElementRegistry, mediaSeekStateRef])
}

const VisualClipLayer = ({
	clip,
	layerOperation,
	layerIndex,
	cursor,
	mediaElementRegistry,
	mediaSeekStateRef,
	onClipMediaError,
}: {
	clip: RenderedClip
	layerOperation: PreviewLayerOperation
	layerIndex: number
	cursor: number
	mediaElementRegistry?: PreviewMediaElementRegistry
	mediaSeekStateRef?: MutableRefObject<Map<string, MediaSeekState>>
	onClipMediaError?: (resourceId: string) => void
}) => {
	const hasMedia = isRealMediaUrl(clip.resourceUrl)
	const filters = mergeColorProgramCssFilters(getPreviewOperationValue<ColorProgram[]>(layerOperation.operations, 'effect', []))
	const opacity = getPreviewOperationValue<number>(layerOperation.operations, 'opacity', clip.opacity)
	const transform = getPreviewOperationValue<RenderedClip['transform']>(layerOperation.operations, 'transform', clip.transform)
	const text = getPreviewOperationValue<RenderedClip['text']>(layerOperation.operations, 'text', clip.text)
	const handleVideoRef = useCallback((element: HTMLVideoElement | null) => {
		if (!mediaElementRegistry) {
			return
		}
		if (element) {
			mediaElementRegistry.set(clip.id, 'video', clip.resourceUrl, element, layerIndex)
			return
		}
		mediaElementRegistry.delete(clip.id, element)
		mediaSeekStateRef?.current.delete(clip.id)
	}, [clip.id, clip.resourceUrl, layerIndex, mediaElementRegistry, mediaSeekStateRef])

	return (
		<div
			className={`ve-renderer__layer ve-renderer__layer--${clip.resourceKind}`}
			style={getLayerStyle({ ...clip, opacity, transform }, filters ? [filters] : [])}
		>
			{hasMedia && clip.resourceKind === 'image' ? (
				<img src={clip.resourceUrl} alt={clip.resourceName} />
			) : null}
			{hasMedia && clip.resourceKind === 'video' ? (
				<video
					ref={mediaElementRegistry ? handleVideoRef : undefined}
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
			{clip.resourceKind === 'text' ? renderTextClip({ ...clip, text }) : null}
			{!hasMedia && clip.resourceKind !== 'text' ? (
				<>
					<strong>{clip.name}</strong>
					<span>{clip.resourceName}</span>
				</>
			) : null}
		</div>
	)
}

const BeforeVideoSnapshotLayer = ({
	clip,
	layerOperation,
	mediaElementRegistry,
	isPlaying,
}: {
	clip: RenderedClip
	layerOperation: PreviewLayerOperation
	mediaElementRegistry: PreviewMediaElementRegistry
	isPlaying: boolean
}) => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const opacity = getPreviewOperationValue<number>(layerOperation.operations, 'opacity', clip.opacity)
	const transform = getPreviewOperationValue<RenderedClip['transform']>(layerOperation.operations, 'transform', clip.transform)

	useEffect(() => {
		const canvas = canvasRef.current
		const sourceVideo = mediaElementRegistry.get(clip.id)?.element
		if (!canvas || !(sourceVideo instanceof HTMLVideoElement)) {
			return
		}

		let frameId = 0
		let resizeFrameId = 0
		const draw = () => {
			drawContainedVideoFrame(canvas, sourceVideo)
			if (isPlaying) {
				frameId = requestAnimationFrame(draw)
			}
		}
		const drawOnce = () => drawContainedVideoFrame(canvas, sourceVideo)
		const scheduleDrawOnce = () => {
			if (resizeFrameId) {
				cancelAnimationFrame(resizeFrameId)
			}
			resizeFrameId = requestAnimationFrame(() => {
				resizeFrameId = 0
				drawOnce()
			})
		}
		const resizeObserver = typeof ResizeObserver !== 'undefined'
			? new ResizeObserver(scheduleDrawOnce)
			: null
		draw()
		resizeObserver?.observe(canvas)
		window.addEventListener('resize', scheduleDrawOnce)
		sourceVideo.addEventListener('loadeddata', drawOnce)
		sourceVideo.addEventListener('seeked', drawOnce)
		sourceVideo.addEventListener('timeupdate', drawOnce)

		return () => {
			if (frameId) {
				cancelAnimationFrame(frameId)
			}
			if (resizeFrameId) {
				cancelAnimationFrame(resizeFrameId)
			}
			resizeObserver?.disconnect()
			window.removeEventListener('resize', scheduleDrawOnce)
			sourceVideo.removeEventListener('loadeddata', drawOnce)
			sourceVideo.removeEventListener('seeked', drawOnce)
			sourceVideo.removeEventListener('timeupdate', drawOnce)
		}
	}, [clip.id, isPlaying, mediaElementRegistry])

	return (
		<div
			className="ve-renderer__layer ve-renderer__layer--video ve-renderer__layer--before-snapshot"
			style={getLayerStyle({ ...clip, opacity, transform }, [])}
		>
			<canvas ref={canvasRef} className="ve-renderer__before-snapshot" aria-hidden="true" />
		</div>
	)
}

const BeforeCompareClipLayer = ({
	clip,
	layerIndex,
	layerOperation,
	cursor,
	mediaElementRegistry,
	isPlaying,
	onClipMediaError,
}: {
	clip: RenderedClip
	layerIndex: number
	layerOperation: PreviewLayerOperation
	cursor: number
	mediaElementRegistry: PreviewMediaElementRegistry
	isPlaying: boolean
	onClipMediaError?: (resourceId: string) => void
}) => {
	if (clip.resourceKind === 'video' && isRealMediaUrl(clip.resourceUrl)) {
		return <BeforeVideoSnapshotLayer clip={clip} layerOperation={layerOperation} mediaElementRegistry={mediaElementRegistry} isPlaying={isPlaying} />
	}

	return (
		<VisualClipLayer
			clip={clip}
			layerIndex={layerIndex}
			layerOperation={layerOperation}
			cursor={cursor}
			onClipMediaError={onClipMediaError}
		/>
	)
}

const AudioClipElement = ({
	clip,
	layerOperation,
	cursor,
	mediaElementRegistry,
	mediaSeekStateRef,
	onClipMediaError,
}: {
	clip: RenderedClip
	layerOperation: PreviewLayerOperation
	cursor: number
	mediaElementRegistry: PreviewMediaElementRegistry
	mediaSeekStateRef: MutableRefObject<Map<string, MediaSeekState>>
	onClipMediaError?: (resourceId: string) => void
}) => {
	const audio = getPreviewOperationValue<RenderedClip['audio']>(layerOperation.operations, 'audio', clip.audio)
	const handleAudioRef = useCallback((element: HTMLAudioElement | null) => {
		if (element) {
			mediaElementRegistry.set(clip.id, 'audio', clip.resourceUrl, element)
			return
		}
		mediaElementRegistry.delete(clip.id, element)
		mediaSeekStateRef.current.delete(clip.id)
	}, [clip.id, clip.resourceUrl, mediaElementRegistry, mediaSeekStateRef])

	return (
		<audio
			ref={handleAudioRef}
			src={clip.resourceUrl}
			data-resource-name={clip.resourceName}
			data-gain={audio.gain}
			data-pan={audio.pan}
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
	)
}

export const RendererStage = ({ structure, frame, isPlaying, mediaElementRegistry, compareMode = 'off', onClipMediaError }: RendererStageProps) => {
	const { canvasRef, renderMode } = usePreviewCanvasRenderer(structure, frame)
	const mediaSeekStateRef = useRef(new Map<string, MediaSeekState>())
	const previewRenderPlan = useMemo(() => compilePreviewRenderPlan(frame), [frame])
	const previewLayerByClipId = useMemo(
		() => new Map(previewRenderPlan.layers.map((layer) => [layer.clipId, layer])),
		[previewRenderPlan],
	)
	const visualLayers = useMemo<PreviewLayerViewModel[]>(() => frame.visualRenderedClips.map((clip, layerIndex) => {
		const operation = previewLayerByClipId.get(clip.id) ?? compilePreviewLayerOperation(clip)
		return {
			clip,
			layerIndex,
			operation,
			beforeOperation: withoutEffectOperations(operation),
		}
	}), [frame.visualRenderedClips, previewLayerByClipId])
	useMediaElementSync(mediaElementRegistry, mediaSeekStateRef, frame, isPlaying)

	const isSplitCompare = compareMode === 'split' && visualLayers.length > 0

	return (
		<div className="ve-renderer" aria-label="Renderer stage">
			<div className="ve-renderer__safe-area">
				<canvas
					ref={canvasRef}
					className="ve-renderer__canvas"
					aria-label="Offscreen preview canvas"
					data-render-mode={renderMode}
				/>
				{visualLayers.length === 0 ? (
					<div className="ve-renderer__empty">No frame at cursor</div>
				) : (
					visualLayers.map(({ clip, layerIndex, operation }) => (
						<VisualClipLayer
							key={clip.id}
							clip={clip}
							layerOperation={operation}
							layerIndex={layerIndex}
							cursor={frame.cursor}
							mediaElementRegistry={mediaElementRegistry}
							mediaSeekStateRef={mediaSeekStateRef}
							onClipMediaError={onClipMediaError}
						/>
					))
				)}
				{isSplitCompare ? (
					<div className="ve-renderer__compare" aria-label="Split compare preview">
						<div className="ve-renderer__compare-before" aria-hidden="true">
							{visualLayers.map(({ clip, layerIndex, beforeOperation }) => (
								<BeforeCompareClipLayer
									key={`before-${clip.id}`}
									clip={clip}
									layerIndex={layerIndex}
									layerOperation={beforeOperation}
									cursor={frame.cursor}
									mediaElementRegistry={mediaElementRegistry}
									isPlaying={isPlaying}
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
							<AudioClipElement
								key={clip.id}
								clip={clip}
								layerOperation={previewLayerByClipId.get(clip.id) ?? compilePreviewLayerOperation(clip)}
								cursor={frame.cursor}
								mediaElementRegistry={mediaElementRegistry}
								mediaSeekStateRef={mediaSeekStateRef}
								onClipMediaError={onClipMediaError}
							/>
						) : null,
					)}
				</div>
			</div>
		</div>
	)
}
