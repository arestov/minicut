import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RenderedClip, PreviewFrame } from '../legend/derivedTimeline'
import { createPreviewScopeData, type PreviewScopeData, type RgbaSampleFrame, type ScopeDensityFrame } from '../render/colorScopes'
import { drawScopeDensityCanvas, drawVectorscopePoints, parseScopeColor, type ScopeRgbColor } from '../render/colorScopeCanvas'

export type ScopeMode = 'waveform' | 'rgb-parade' | 'vectorscope'

const scopeSampleWidth = 192
const scopeSampleHeight = 108
const waveformTintColor = parseScopeColor('#f4f4f5')
const redParadeTintColor = parseScopeColor('#ef4444')
const greenParadeTintColor = parseScopeColor('#22c55e')
const blueParadeTintColor = parseScopeColor('#3b82f6')
const vectorscopeTintColor = parseScopeColor('#a1a1aa')

const getScopeSampleKey = (clips: RenderedClip[], cursor: number): string =>
	clips.map((clip) => `${clip.id}:${clip.resourceUrl}:${Math.round((cursor - clip.start + clip.inPoint) * 2) / 2}`).join('|')

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

const loadVideoSampleFrame = (clip: RenderedClip, cursor: number): Promise<RgbaSampleFrame | null> => new Promise((resolve) => {
	const video = document.createElement('video')
	let done = false
	let timeoutId = 0
	const finish = (frame: RgbaSampleFrame | null) => {
		if (done) {
			return
		}
		done = true
		window.clearTimeout(timeoutId)
		video.removeAttribute('src')
		video.load()
		resolve(frame)
	}
	const draw = () => {
		try {
			finish(drawElementToSampleFrame(video))
		} catch {
			finish(null)
		}
	}
	timeoutId = window.setTimeout(() => finish(null), 2200)
	video.crossOrigin = 'anonymous'
	video.muted = true
	video.playsInline = true
	video.preload = 'auto'
	video.addEventListener('error', () => {
		window.clearTimeout(timeoutId)
		finish(null)
	}, { once: true })
	video.addEventListener('loadeddata', () => {
		const targetTime = Math.max(0, cursor - clip.start + clip.inPoint)
		if (targetTime <= 0.05) {
			draw()
			return
		}
		if (Number.isFinite(video.duration) && video.duration > 0) {
			try {
				video.currentTime = Math.min(video.duration - 0.05, targetTime)
			} catch {
				draw()
			}
			return
		}
		draw()
	}, { once: true })
	video.addEventListener('seeked', () => {
		draw()
	}, { once: true })
	video.src = clip.resourceUrl
})

const usePreviewScopeSamples = (clips: RenderedClip[], cursor: number): Record<string, RgbaSampleFrame | undefined> => {
	const [samples, setSamples] = useState<Record<string, RgbaSampleFrame | undefined>>({})
	const sampleKey = useMemo(() => getScopeSampleKey(clips, cursor), [clips, cursor])

	useEffect(() => {
		if (typeof document === 'undefined' || navigator.userAgent.includes('jsdom')) {
			return
		}

		let cancelled = false
		const loadSamples = async () => {
			const entries = await Promise.all(clips.map(async (clip) => {
				if (!clip.resourceUrl || clip.resourceKind === 'text' || clip.resourceKind === 'audio') {
					return [clip.id, undefined] as const
				}

				const frame = clip.resourceKind === 'image'
					? await loadImageSampleFrame(clip.resourceUrl)
					: await loadVideoSampleFrame(clip, cursor)
				return [clip.id, frame ?? undefined] as const
			}))
			if (!cancelled) {
				setSamples(Object.fromEntries(entries))
			}
		}

		void loadSamples()
		return () => {
			cancelled = true
		}
	}, [sampleKey])

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
		drawScopeDensityCanvas(context, frame, tint)
		if (vectorscopePoints.length > 0) {
			drawVectorscopePoints(context, vectorscopePoints, frame.width, frame.height)
		}
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

export const ColorScopesPanel = observer(({
	frame$,
	mode,
	onModeChange,
	resolveResourceUrl,
}: {
	frame$: Observable<PreviewFrame>
	mode: ScopeMode
	onModeChange: (mode: ScopeMode) => void
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string
}) => {
	const frame = frame$.get()
	const resolvedClips = useMemo(
		() => frame.visualRenderedClips.map((clip) => ({
			...clip,
			resourceUrl: clip.resourceId ? resolveResourceUrl(clip.resourceId, clip.resourceUrl) : clip.resourceUrl,
		})),
		[frame.visualRenderedClips, resolveResourceUrl],
	)
	const sampleFrames = usePreviewScopeSamples(resolvedClips, frame.cursor)
	const scopeClipKey = useMemo(() => getScopeClipKey(resolvedClips), [resolvedClips])
	const scopes: PreviewScopeData = useMemo(
		() => createPreviewScopeData(resolvedClips, sampleFrames, {
			includeWaveform: mode === 'waveform',
			includeRgbParade: mode === 'rgb-parade',
			includeVectorscope: mode === 'vectorscope',
			includeVectorscopePoints: mode === 'vectorscope',
		}),
		[scopeClipKey, sampleFrames, mode],
	)
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
})
