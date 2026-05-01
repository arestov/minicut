import { observer } from '@legendapp/state/react'
import { useEffect, useRef, useState } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ClipAttrs, Entity, EntityId, KeyframeAttrs, ResourceAttrs } from '../domain/types'
import type { ScalarKeyframe } from '../render/timing'
import { evaluateKeyframedScalar } from '../render/timing'
import PreviewCanvasWorker from './previewCanvasWorker?worker'

const offscreenWorkers = new WeakMap<HTMLCanvasElement, Worker>()

interface RenderedClip {
	id: string
	name: string
	color: string
	resourceName: string
	resourceKind: ResourceAttrs['kind']
	resourceUrl: string
	mime: string
	inPoint: number
	start: number
	opacity: number
	transform: { x: number; y: number; scale: number; rotation: number }
	filters: string[]
}

const isRealMediaUrl = (url: string): boolean =>
	url.startsWith('blob:') || url.startsWith('/') || url.startsWith('./') || url.startsWith('http') || url.startsWith('data:')

const getEffectFilter = (effect: Entity): string | null => {
	const kind = String(effect.attrs.kind)
	const amount = Number(effect.attrs.amount) || 0

	if (kind === 'blur') {
		return `blur(${Math.round(amount * 10)}px)`
	}

	if (kind === 'sharpen') {
		return `contrast(${1 + amount}) saturate(${1 + amount * 0.5})`
	}

	if (kind === 'tint') {
		return `sepia(${amount}) saturate(${1 + amount})`
	}

	return null
}

const drawFallbackPreview = (
	canvas: HTMLCanvasElement,
	cursor: number,
	clips: RenderedClip[],
): void => {
	const context = canvas.getContext('2d')
	if (!context) {
		return
	}

	const width = canvas.clientWidth || 640
	const height = canvas.clientHeight || 360
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
		context.fillText(`${clip.resourceKind}: ${clip.name}`, 30, y + 14)
	})
}

const getClipLocalMediaTime = (clip: RenderedClip, cursor: number): number =>
	Math.max(0, clip.inPoint + cursor - clip.start)

const getKeyframeResolver = (
	projects$: ReturnType<typeof useVideoEditor>['projects$'],
): ((id: EntityId) => ScalarKeyframe | null) => (id) => {
	const keyframe$ = projects$.entitiesById[id]
	if (!keyframe$ || keyframe$.type.get() !== 'keyframe') {
		return null
	}

	const attrs = keyframe$.attrs.get() as unknown as KeyframeAttrs
	return Number.isFinite(attrs.time) && Number.isFinite(attrs.value)
		? { time: attrs.time, value: attrs.value, interpolation: attrs.interpolation }
		: null
}

const seekMediaElement = (element: HTMLMediaElement, localTime: number): void => {
	if (Number.isFinite(localTime) && Math.abs(element.currentTime - localTime) > 0.05) {
		try {
			element.currentTime = localTime
		} catch {
			// Some browsers reject seeking before metadata is ready; metadata handlers retry.
		}
	}
}

export const RendererStage = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const workerRef = useRef<Worker | null>(null)
	const mediaElementsRef = useRef(new Map<string, HTMLMediaElement>())
	const [renderMode, setRenderMode] = useState<'offscreen' | 'fallback'>('fallback')
	const cursor = session$.cursor.get()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const project$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = project$?.rootEntityId.get()
	const timelineId = rootEntityId ? projects$.entitiesById[rootEntityId].rels.activeTimeline.get() : null
	const trackIds = typeof timelineId === 'string'
		? projects$.entitiesById[timelineId].rels.tracks.get()
		: []
	const activeClipIds: string[] = []
	const resolveKeyframe = getKeyframeResolver(projects$)

	if (Array.isArray(trackIds)) {
		for (const trackId of trackIds) {
			const clipIds = projects$.entitiesById[trackId].rels.clips.get()
			if (!Array.isArray(clipIds)) {
				continue
			}

			for (const clipId of clipIds) {
				const clip$ = projects$.entitiesById[clipId]
				const start = Number(clip$.attrs.start.get())
				const duration = Number(clip$.attrs.duration.get())
				if (cursor >= start && cursor < start + duration) {
					activeClipIds.push(clipId)
				}
			}
		}
	}

	const renderedClips: RenderedClip[] = activeClipIds.map((clipId) => {
		const clip$ = projects$.entitiesById[clipId]
		const attrs = clip$.attrs.get() as unknown as ClipAttrs
		const localTime = Math.max(0, cursor - attrs.start)
		const resourceId = clip$.rels.resource.get()
		const resourceAttrs = typeof resourceId === 'string'
			? projects$.entitiesById[resourceId].attrs.get() as unknown as ResourceAttrs
			: null
		const effectIds = clip$.rels.effects.get()
		const filters = Array.isArray(effectIds)
			? effectIds
				.map((effectId) => getEffectFilter(projects$.entitiesById[effectId].get() as Entity))
				.filter((filter): filter is string => Boolean(filter))
			: []

		return {
			id: clipId,
			name: attrs.name,
			color: String(attrs.color ?? '#2563eb'),
			resourceName: resourceAttrs?.name ?? attrs.name,
			resourceKind: resourceAttrs?.kind ?? 'image',
			resourceUrl: resourceAttrs?.url ?? '',
			mime: resourceAttrs?.mime ?? '',
			inPoint: attrs.in,
			start: attrs.start,
			opacity: evaluateKeyframedScalar(attrs.opacity, localTime, resolveKeyframe),
			transform: {
				x: evaluateKeyframedScalar(attrs.transform.x, localTime, resolveKeyframe),
				y: evaluateKeyframedScalar(attrs.transform.y, localTime, resolveKeyframe),
				scale: evaluateKeyframedScalar(attrs.transform.scale, localTime, resolveKeyframe),
				rotation: evaluateKeyframedScalar(attrs.transform.rotation, localTime, resolveKeyframe),
			},
			filters,
		}
	})

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) {
			return
		}
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

		const width = canvas.clientWidth || 640
		const height = canvas.clientHeight || 360
		const clips = renderedClips.map((clip) => ({
			name: clip.name,
			color: clip.color,
			kind: clip.resourceKind,
			opacity: clip.opacity,
		}))
		if (workerRef.current) {
			workerRef.current.postMessage({ type: 'render', width, height, cursor, clips })
			return
		}

		setRenderMode('fallback')
		drawFallbackPreview(canvas, cursor, renderedClips)
	}, [cursor, renderedClips])

	useEffect(() => {
		for (const clip of renderedClips) {
			if (clip.resourceKind !== 'video' && clip.resourceKind !== 'audio') {
				continue
			}

			const element = mediaElementsRef.current.get(clip.id)
			if (!element) {
				continue
			}

			seekMediaElement(element, getClipLocalMediaTime(clip, cursor))
		}
	}, [cursor, renderedClips])

	return (
		<div className="ve-renderer" aria-label="Renderer stage">
			<div className="ve-renderer__safe-area">
				<canvas
					ref={canvasRef}
					className="ve-renderer__canvas"
					aria-label="Offscreen preview canvas"
					data-render-mode={renderMode}
				/>
				{renderedClips.length === 0 ? (
					<div className="ve-renderer__empty">No frame at cursor</div>
				) : (
					renderedClips.map((clip) => {
						const hasMedia = isRealMediaUrl(clip.resourceUrl)
						return (
							<div
								key={clip.id}
								className={`ve-renderer__layer ve-renderer__layer--${clip.resourceKind}`}
								style={{
									opacity: clip.opacity,
									filter: clip.filters.join(' '),
									borderColor: clip.color,
									boxShadow: `0 0 0 2px ${clip.color}, 0 20px 45px rgba(0, 0, 0, 0.3)`,
									transform: `translate(${clip.transform.x}px, ${clip.transform.y}px) scale(${clip.transform.scale}) rotate(${clip.transform.rotation}deg)`,
								}}
							>
								{hasMedia && clip.resourceKind === 'image' ? (
									<img src={clip.resourceUrl} alt={clip.resourceName} />
								) : null}
								{hasMedia && clip.resourceKind === 'video' ? (
									<video
										ref={(element) => {
											if (element) {
												mediaElementsRef.current.set(clip.id, element)
												return
											}
											mediaElementsRef.current.delete(clip.id)
										}}
										src={clip.resourceUrl}
										muted
										playsInline
										preload="metadata"
										onLoadedMetadata={(event) => seekMediaElement(event.currentTarget, getClipLocalMediaTime(clip, cursor))}
									/>
								) : null}
								{hasMedia && clip.resourceKind === 'audio' ? (
									<div className="ve-renderer__audio" aria-label="Audio preview">
										<span>{clip.resourceName}</span>
										<audio
											ref={(element) => {
												if (element) {
													mediaElementsRef.current.set(clip.id, element)
													return
												}
												mediaElementsRef.current.delete(clip.id)
											}}
											src={clip.resourceUrl}
											preload="metadata"
											controls
											onLoadedMetadata={(event) => seekMediaElement(event.currentTarget, getClipLocalMediaTime(clip, cursor))}
										/>
									</div>
								) : null}
								{!hasMedia ? (
									<>
										<strong>{clip.name}</strong>
										<span>{clip.resourceName}</span>
									</>
								) : null}
							</div>
						)
					})
				)}
			</div>
		</div>
	)
})
