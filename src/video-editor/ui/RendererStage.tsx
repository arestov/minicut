import { observer } from '@legendapp/state/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ClipAttrs, Entity, ResourceAttrs, TransformAttrs } from '../domain/types'
import PreviewCanvasWorker from './previewCanvasWorker?worker'

interface RenderedClip {
	id: string
	name: string
	resourceName: string
	resourceKind: ResourceAttrs['kind']
	resourceUrl: string
	mime: string
	opacity: number
	transform: TransformAttrs
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
		context.textAlign = 'center'
		context.fillText('No frame at cursor', width / 2, height / 2)
		context.textAlign = 'left'
		return
	}

	clips.forEach((clip, index) => {
		const y = 54 + index * 28
		context.globalAlpha = Math.max(0.2, clip.opacity)
		context.fillStyle = clip.resourceKind === 'audio' ? '#cffafe' : clip.resourceKind === 'video' ? '#dbeafe' : '#dcfce7'
		context.fillRect(22, y, Math.min(width - 44, 260), 20)
		context.globalAlpha = 1
		context.fillStyle = '#18181b'
		context.font = '600 12px Inter, Segoe UI, sans-serif'
		context.fillText(`${clip.resourceKind}: ${clip.name}`, 30, y + 14)
	})
}

export const RendererStage = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const workerRef = useRef<Worker | null>(null)
	const [renderMode, setRenderMode] = useState<'offscreen' | 'fallback'>('fallback')
	const cursor = session$.cursor.get()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const project$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = project$?.rootEntityId.get()
	const timelineId = rootEntityId ? projects$.entitiesById[rootEntityId].rels.activeTimeline.get() : null
	const trackIds = typeof timelineId === 'string'
		? projects$.entitiesById[timelineId].rels.tracks.get()
		: []
	const renderedClips: RenderedClip[] = []

	if (Array.isArray(trackIds)) {
		for (const trackId of trackIds) {
			const clipIds = projects$.entitiesById[trackId].rels.clips.get()
			if (!Array.isArray(clipIds)) {
				continue
			}

			for (const clipId of clipIds) {
				const clip$ = projects$.entitiesById[clipId]
				const attrs = clip$.attrs.get() as unknown as ClipAttrs
				if (cursor < attrs.start || cursor >= attrs.start + attrs.duration) {
					continue
				}

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

				renderedClips.push({
					id: clipId,
					name: attrs.name,
					resourceName: resourceAttrs?.name ?? attrs.name,
					resourceKind: resourceAttrs?.kind ?? 'image',
					resourceUrl: resourceAttrs?.url ?? '',
					mime: resourceAttrs?.mime ?? '',
					opacity: attrs.opacity.value,
					transform: attrs.transform,
					filters,
				})
			}
		}
	}

	const renderPayload = useMemo(() => ({
		cursor,
		clips: renderedClips.map((clip) => ({
			name: clip.name,
			kind: clip.resourceKind,
			opacity: clip.opacity,
		})),
	}), [cursor, renderedClips])

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) {
			return
		}
		if (navigator.userAgent.includes('jsdom')) {
			return
		}

		if (!workerRef.current && 'transferControlToOffscreen' in canvas) {
			const offscreen = canvas.transferControlToOffscreen()
			const worker = new PreviewCanvasWorker()
			worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
			workerRef.current = worker
			setRenderMode('offscreen')
		}

		const width = canvas.clientWidth || 640
		const height = canvas.clientHeight || 360
		if (workerRef.current) {
			workerRef.current.postMessage({ type: 'render', width, height, ...renderPayload })
			return
		}

		setRenderMode('fallback')
		drawFallbackPreview(canvas, renderPayload.cursor, renderedClips)
	}, [renderPayload, renderedClips])

	useEffect(() => () => {
		workerRef.current?.terminate()
		workerRef.current = null
	}, [])

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
									transform: `translate(${clip.transform.x.value}px, ${clip.transform.y.value}px) scale(${clip.transform.scale.value}) rotate(${clip.transform.rotation.value}deg)`,
								}}
							>
								{hasMedia && clip.resourceKind === 'image' ? (
									<img src={clip.resourceUrl} alt={clip.resourceName} />
								) : null}
								{hasMedia && clip.resourceKind === 'video' ? (
									<video src={clip.resourceUrl} muted playsInline preload="metadata" />
								) : null}
								{hasMedia && clip.resourceKind === 'audio' ? (
									<div className="ve-renderer__audio" aria-label="Audio preview">
										<span>{clip.resourceName}</span>
										<audio src={clip.resourceUrl} preload="metadata" controls />
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
