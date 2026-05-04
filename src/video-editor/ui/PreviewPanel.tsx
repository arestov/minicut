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
import { createPreviewScopeData, type PreviewScopeData } from '../render/colorScopes'
import type { EditorSessionState } from '../domain/types'
import { formatSeconds } from './format'
import { Button, IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

const previewWindowRequestIntervalMs = 200

type ScopeMode = 'waveform' | 'rgb-parade' | 'vectorscope'

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

const clampPercent = (value: number): number => Math.min(96, Math.max(4, value))

const getTracePoints = (buckets: number[]): string =>
	buckets.map((value, index) => {
		const x = buckets.length <= 1 ? 0 : (index / (buckets.length - 1)) * 100
		const y = 96 - Math.min(0.96, Math.max(0, value)) * 92
		return `${x.toFixed(2)},${y.toFixed(2)}`
	}).join(' ')

const ScopeTrace = ({ buckets, tint, label }: { buckets: number[]; tint: string; label: string }) => {
	const points = getTracePoints(buckets)
	return (
		<svg className="ve-scope-trace" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={label} role="img">
			<polygon className="ve-scope-trace__fill" points={`0,100 ${points} 100,100`} style={{ fill: tint }} />
			<polyline className="ve-scope-trace__line" points={points} style={{ stroke: tint }} />
		</svg>
	)
}

const ColorScopesPanel = observer(({ frame$, mode, onModeChange }: {
	frame$: Observable<PreviewFrame>
	mode: ScopeMode
	onModeChange: (mode: ScopeMode) => void
}) => {
	const frame = frame$.get()
	const scopes: PreviewScopeData = useMemo(
		() => createPreviewScopeData(frame.visualRenderedClips),
		[frame.visualRenderedClips],
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
					<ScopeTrace buckets={scopes.waveform.buckets} tint="#f4f4f5" label="Waveform luma trace" />
				) : null}
				{!isEmpty && mode === 'rgb-parade' ? (
					<div className="ve-scopes__parade">
						<ScopeTrace buckets={scopes.rgbParade.red} tint="#ef4444" label="Red parade trace" />
						<ScopeTrace buckets={scopes.rgbParade.green} tint="#22c55e" label="Green parade trace" />
						<ScopeTrace buckets={scopes.rgbParade.blue} tint="#3b82f6" label="Blue parade trace" />
					</div>
				) : null}
				{!isEmpty && mode === 'vectorscope' ? (
					<div className="ve-scopes__vectors" aria-label="Vectorscope points">
						{scopes.vectorscope.points.map((point, index) => (
							<span
								key={index}
								className="ve-scope-point"
								style={{
									left: `${clampPercent(50 + point.x * 42)}%`,
									top: `${clampPercent(50 - point.y * 42)}%`,
									backgroundColor: point.tint,
								}}
							/>
						))}
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
			{showColorScopes ? <ColorScopesPanel frame$={previewFrame$} mode={scopeMode} onModeChange={setScopeMode} /> : null}
			<PreviewTransport
				frame$={previewFrame$}
				session$={session$}
				onTogglePlayback={() => actions.togglePlayback()}
			/>
		</section>
	)
}
