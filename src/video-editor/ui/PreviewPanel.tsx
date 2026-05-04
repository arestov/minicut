import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	createPreviewFrame$,
	createPreviewStructure$,
	type RenderedClip,
	type PreviewFrame,
	type PreviewStructure,
} from '../legend/derivedTimeline'
import { createPreviewScopeData, type PreviewScopeData, type RgbaSampleFrame, type ScopeDensityFrame } from '../render/colorScopes'
import { drawScopeDensityCanvas, drawVectorscopePoints, parseScopeColor, type ScopeRgbColor } from '../render/colorScopeCanvas'
import type { EditorSessionState } from '../domain/types'
import { formatSeconds } from './format'
import { Button, IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

const previewWindowRequestIntervalMs = 200

type ScopeMode = 'waveform' | 'rgb-parade' | 'vectorscope'

const scopeSampleWidth = 192
const scopeSampleHeight = 108
const waveformTintColor = parseScopeColor('#f4f4f5')
const redParadeTintColor = parseScopeColor('#ef4444')
const greenParadeTintColor = parseScopeColor('#22c55e')
const blueParadeTintColor = parseScopeColor('#3b82f6')
const vectorscopeTintColor = parseScopeColor('#a1a1aa')

const PreviewStage = observer(({
	frame$,
	structure$,
	session$,
	resolveResourceUrl,
	requestResourcePlayheadWindow,
	noteResourcePreviewError,
	compareMode,
}: {
	frame$: Observable<PreviewFrame>
	structure$: Observable<PreviewStructure>
	session$: Observable<EditorSessionState>
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string
	requestResourcePlayheadWindow: (resourceId: string, time: number) => void
	noteResourcePreviewError: (resourceId: string) => void
	compareMode: 'off' | 'split'
}) => {
	const frame = frame$.get()
	const isPlaying = session$.isPlaying.get()
	const lastWindowRequestAtRef = useRef(new Map<string, number>())
	const resolvedClip = (clip: RenderedClip): RenderedClip => ({
		...clip,
		resourceUrl: clip.resourceId ? resolveResourceUrl(clip.resourceId, clip.resourceUrl) : clip.resourceUrl,
	})
	const resolvedFrame: PreviewFrame = {
		...frame,
		renderedClips: frame.renderedClips.map(resolvedClip),
		visualRenderedClips: frame.visualRenderedClips.map(resolvedClip),
		audioRenderedClips: frame.audioRenderedClips.map(resolvedClip),
	}

	useEffect(() => {
		const now = performance.now()
		for (const clip of frame.renderedClips) {
			if (!clip.resourceId || (clip.resourceKind !== 'video' && clip.resourceKind !== 'audio')) {
				continue
			}

			const lastRequestedAt = lastWindowRequestAtRef.current.get(clip.resourceId) ?? 0
			if (isPlaying && now - lastRequestedAt < previewWindowRequestIntervalMs) {
				continue
			}

			lastWindowRequestAtRef.current.set(clip.resourceId, now)
			requestResourcePlayheadWindow(clip.resourceId, Math.max(0, frame.cursor - clip.start + clip.inPoint))
		}
	}, [frame, isPlaying, requestResourcePlayheadWindow])

	return (
		<RendererStage
			structure={structure$.get()}
			frame={resolvedFrame}
			isPlaying={isPlaying}
			compareMode={compareMode}
			onClipMediaError={(resourceId) => noteResourcePreviewError(resourceId)}
		/>
	)
})

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

const ColorScopesPanel = observer(({ frame$, mode, onModeChange, resolveResourceUrl }: {
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
				{!isEmpty && mode === 'waveform' ? (
					<ScopeDensityCanvas frame={scopes.waveform} tint={waveformTintColor} label="Waveform luma density" />
				) : null}
				{!isEmpty && mode === 'rgb-parade' ? (
					<div className="ve-scopes__parade">
						<ScopeDensityCanvas frame={{ width: scopes.rgbParade.width, height: scopes.rgbParade.height, cells: scopes.rgbParade.red }} tint={redParadeTintColor} label="Red parade density" />
						<ScopeDensityCanvas frame={{ width: scopes.rgbParade.width, height: scopes.rgbParade.height, cells: scopes.rgbParade.green }} tint={greenParadeTintColor} label="Green parade density" />
						<ScopeDensityCanvas frame={{ width: scopes.rgbParade.width, height: scopes.rgbParade.height, cells: scopes.rgbParade.blue }} tint={blueParadeTintColor} label="Blue parade density" />
					</div>
				) : null}
				{!isEmpty && mode === 'vectorscope' ? (
					<div className="ve-scopes__vectors" aria-label="Vectorscope points">
						<ScopeDensityCanvas frame={scopes.vectorscope} tint={vectorscopeTintColor} label="Vectorscope chroma density" className="ve-scope-density--vectors" vectorscopePoints={scopes.vectorscope.points} />
					</div>
				) : null}
			</div>
		</div>
	)
})

const PreviewPlaybackButton = observer(({
	session$,
	onTogglePlayback,
}: {
	session$: Observable<EditorSessionState>
	onTogglePlayback: () => void
}) => {
	const isPlaying = session$.isPlaying.get()

	return (
		<IconButton
			type="button"
			icon={isPlaying ? Pause : Play}
			label={isPlaying ? 'Pause' : 'Play'}
			variant="default"
			onClick={onTogglePlayback}
		>
			{isPlaying ? 'Pause' : 'Play'}
		</IconButton>
	)
})

const PreviewCursorReadout = observer(({ frame$ }: { frame$: Observable<PreviewFrame> }) => {
	const cursor = frame$.cursor.get()

	return (
		<>
			<span className="ve-sr-only">Cursor at {formatSeconds(cursor)}</span>
			<span>{formatSeconds(cursor)}</span>
		</>
	)
})

const PreviewActiveClipsReadout = observer(({ frame$ }: { frame$: Observable<PreviewFrame> }) => {
	const activeClipNames = frame$.activeClipNames.get()

	return (
		<span>{activeClipNames.length > 0 ? activeClipNames.join(', ') : 'No active clips'}</span>
	)
})

const PreviewTransport = ({
	frame$,
	session$,
	onTogglePlayback,
}: {
	frame$: Observable<PreviewFrame>
	session$: Observable<EditorSessionState>
	onTogglePlayback: () => void
}) => {
	return (
		<div className="ve-preview-transport" aria-label="Preview transport status">
			<div>
				<Timer size={15} aria-hidden="true" />
				<PreviewCursorReadout frame$={frame$} />
			</div>
			<div>
				<Gauge size={15} aria-hidden="true" />
				<span>Draft preview</span>
			</div>
			<div className="ve-preview-transport__active">
				<PreviewActiveClipsReadout frame$={frame$} />
			</div>
			<div className="ve-preview-transport__playback">
				<PreviewPlaybackButton
					session$={session$}
					onTogglePlayback={onTogglePlayback}
				/>
			</div>
		</div>
	)
}

export const PreviewPanel = () => {
	const { projects$, session$, actions, resolveResourceUrl, requestResourcePlayheadWindow, noteResourcePreviewError } = useVideoEditor()
	const [compareMode, setCompareMode] = useState<'off' | 'split'>('off')
	const [scopeMode, setScopeMode] = useState<ScopeMode>('waveform')
	const showColorScopes = session$.activeInspectorTab.get() === 'color'
	const previewStructure$ = useMemo(
		() => createPreviewStructure$(projects$, session$),
		[projects$, session$],
	)
	const previewFrame$ = useMemo(
		() => createPreviewFrame$(previewStructure$, session$),
		[previewStructure$, session$],
	)

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
				<div className="ve-preview-tools" aria-label="Preview color tools">
					<Button
						type="button"
						variant={compareMode === 'split' ? 'default' : 'secondary'}
						onClick={() => setCompareMode((value) => value === 'split' ? 'off' : 'split')}
					>
						Split compare
					</Button>
				</div>
			</div>
			<PreviewStage
				frame$={previewFrame$}
				structure$={previewStructure$}
				session$={session$}
				resolveResourceUrl={resolveResourceUrl}
				requestResourcePlayheadWindow={requestResourcePlayheadWindow}
				noteResourcePreviewError={noteResourcePreviewError}
				compareMode={compareMode}
			/>
			{showColorScopes ? <ColorScopesPanel frame$={previewFrame$} mode={scopeMode} onModeChange={setScopeMode} resolveResourceUrl={resolveResourceUrl} /> : null}
			<PreviewTransport
				frame$={previewFrame$}
				session$={session$}
				onTogglePlayback={() => actions.togglePlayback()}
			/>
		</section>
	)
}
