import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { observer } from '@legendapp/state/react'
import type { LucideIcon } from 'lucide-react'
import { Download, Gauge, Move, Palette, Scissors, SlidersHorizontal, Sparkles, Volume2, Wand2, X } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { createPaletteFromHex, readVideoFrameImageData, sampleVideoFramePalette } from '../color/framePalette'
import { buildLookColorCorrectionParams, getLookPreset, lookPresets, type LookParam } from '../color/looks'
import type { AnimatedScalar, ColorCorrectionAttrs, EditorSessionState, EffectAttrs, ResourceAttrs, TextAttrs } from '../domain/types'
import { createSelectedClipTrackPosition$ } from '../legend/derivedTimeline'
import {
	clipAttrs$,
	clipRels$,
	effectAttrs$,
	getActiveProjectId$,
	resourceAttrs$,
	textAttrs$,
} from '../legend/observableSelectors'
import type { ExportProgressEvent, ExportRenderResult } from '../render/exportRenderer'
import { Button, IconButton } from './ControlPrimitives'
import { formatPercent, formatSeconds } from './format'
import type { FramePaletteStatus } from './FramePaletteAction'
import { LookBrowser } from './LookBrowser'
import type { PreviewMediaElementRegistry } from './mediaElementRegistry'
import { TextAppearancePanel } from './TextAppearancePanel'
import LookThumbnailWorker from './lookThumbnailWorker?worker'

type InspectorTab = EditorSessionState['activeInspectorTab']

type ExportStatus =
	| { state: 'idle' }
	| { state: 'rendering'; progress: ExportProgressEvent }
	| { state: 'ready'; result: ExportRenderResult }
	| { state: 'error'; message: string }

const exportStageLabel: Record<ExportProgressEvent['stage'], string> = {
	queued: 'queued',
	rendering: 'rendering',
	finalizing: 'finalizing',
	done: 'done',
}

const formatExportProgress = (event: ExportProgressEvent): string => {
	const progressPercent = Math.round(Math.max(0, Math.min(1, event.progress)) * 100)
	return `${exportStageLabel[event.stage]} ${progressPercent}%`
}

const inspectorTabs: Array<{ id: InspectorTab, label: string }> = [
	{ id: 'edit', label: 'Edit' },
	{ id: 'color', label: 'Color' },
	{ id: 'audio', label: 'Audio' },
	{ id: 'export', label: 'Export' },
]

type PrimaryColorParam = keyof Pick<ColorCorrectionAttrs, 'exposure' | 'contrast' | 'saturation' | 'temperature'>
type ColorParamKey = PrimaryColorParam | LookParam

const defaultColorCorrectionParams: Record<PrimaryColorParam, AnimatedScalar> = {
	exposure: { value: 0 },
	contrast: { value: 1 },
	saturation: { value: 1 },
	temperature: { value: 0 },
}

const colorGradePresets: Array<{ id: string, label: string, params: Partial<Record<PrimaryColorParam, number>> }> = [
	{ id: 'neutral', label: 'Neutral', params: { exposure: 0, contrast: 1, saturation: 1, temperature: 0 } },
	{ id: 'warm', label: 'Warm', params: { exposure: 0.12, contrast: 1.08, saturation: 1.15, temperature: 0.22 } },
	{ id: 'cool', label: 'Cool', params: { exposure: 0.05, contrast: 1.04, saturation: 0.92, temperature: -0.2 } },
	{ id: 'punch', label: 'Punch', params: { exposure: 0.08, contrast: 1.2, saturation: 1.35, temperature: 0 } },
]

const InspectorTabs = ({ activeTab, onChange, disabled = false }: {
	activeTab: InspectorTab
	onChange: (tab: InspectorTab) => void
	disabled?: boolean
}) => (
	<div className="ve-inspector-tabs" role="tablist" aria-label="Inspector tabs">
		{inspectorTabs.map((tab) => (
			<button
				key={tab.id}
				type="button"
				role="tab"
				aria-selected={tab.id === activeTab}
				className={tab.id === activeTab ? 'is-active' : ''}
				onClick={() => onChange(tab.id)}
				disabled={disabled}
			>
				{tab.label}
			</button>
		))}
	</div>
)

const InspectorSection = ({
	title,
	children,
	icon: Icon,
	ariaLabel,
}: {
	title: string
	children: ReactNode
	icon?: LucideIcon
	ariaLabel?: string
}) => (
	<section className="ve-property-section" aria-label={ariaLabel}>
		<div className="ve-property-section__header">
			{Icon ? <Icon size={15} aria-hidden="true" /> : null}
			<h3>{title}</h3>
		</div>
		{children}
	</section>
)

const isPreviewableResourceUrl = (url: string): boolean =>
	url.startsWith('blob:')
	|| url.startsWith('/')
	|| url.startsWith('./')
	|| url.startsWith('http')
	|| url.startsWith('data:')

const ClipHeaderPreview = ({ resource, color, name }: {
	resource: ResourceAttrs | null
	color: string
	name: string
}) => {
	const url = String(resource?.url ?? '')
	const kind = String(resource?.kind ?? '')
	const canPreview = isPreviewableResourceUrl(url)

	return (
		<div className="ve-inspector-thumb" style={{ borderColor: color }} aria-label="Clip preview">
			{canPreview && kind === 'image' ? <img src={url} alt="" /> : null}
			{canPreview && kind === 'video' ? <video src={url} muted preload="metadata" aria-label={`${name} first frame`} /> : null}
			{!canPreview || (kind !== 'image' && kind !== 'video') ? <span>{kind === 'audio' ? 'AUD' : 'CLIP'}</span> : null}
		</div>
	)
}

const InspectorClipHeader = observer(({ clipId }: { clipId: string }) => {
	const { projects$, session$, actions } = useVideoEditor()
	const selectedClipTrackPosition$ = useMemo(
		() => createSelectedClipTrackPosition$(projects$, session$),
		[projects$, session$],
	)
	const selectedClip$ = clipAttrs$(projects$, clipId)
	const selectedClipRels$ = clipRels$(projects$, clipId)
	const name = String(selectedClip$.name.get())
	const color = String(selectedClip$.color.get() ?? '#2563eb')
	const start = Number(selectedClip$.start.get())
	const duration = Number(selectedClip$.duration.get())
	const resourceId = selectedClipRels$.resource.get()
	const resource = typeof resourceId === 'string'
		? resourceAttrs$(projects$, resourceId).get() as ResourceAttrs
		: null
	const selectedClipTrackPosition = selectedClipTrackPosition$.get()
	const selectedTrackName = selectedClipTrackPosition?.trackName ?? 'Track'
	const selectedClipOrdinal = selectedClipTrackPosition?.ordinal ?? 1

	return (
		<div className="ve-inspector-selected">
			<ClipHeaderPreview resource={resource} color={color} name={name} />
			<div>
				<input
					className="ve-inspector-name ve-inspector-title-input"
					type="text"
					aria-label="Clip name"
					value={name}
					onChange={(event) => actions.renameSelectedClip(event.currentTarget.value)}
				/>
				<small>Clip {selectedClipOrdinal} - {selectedTrackName} - {formatSeconds(start)} - Duration {formatSeconds(duration)}</small>
			</div>
		</div>
	)
})

const InspectorEditTabPanel = observer(({ clipId, mediaElementRegistry }: { clipId: string; mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const [isEffectsMenuOpen, setIsEffectsMenuOpen] = useState(false)
	const [paletteStatus, setPaletteStatus] = useState<FramePaletteStatus>('idle')
	const { projects$, actions } = useVideoEditor()
	const selectedClip$ = clipAttrs$(projects$, clipId)
	const selectedClipRels$ = clipRels$(projects$, clipId)
	const opacity = Number(selectedClip$.opacity.value.get())
	const opacityPercent = Math.round(opacity * 100)
	const inPoint = Number(selectedClip$.in.get())
	const fadeIn = Number(selectedClip$.fadeIn.get() ?? 0)
	const fadeOut = Number(selectedClip$.fadeOut.get() ?? 0)
	const duration = Number(selectedClip$.duration.get())
	const start = Number(selectedClip$.start.get())
	const transform = selectedClip$.transform.get()
	const textId = selectedClipRels$.text.get()
	const text = typeof textId === 'string' ? textAttrs$(projects$, textId).get() : null
	const updateTextStyle = (style: Partial<TextAttrs['style']>): void => {
		if (!text) {
			return
		}
		actions.updateSelectedText({ style: { ...text.style, ...style } })
	}
	const applyFramePalette = (): void => {
		if (!text) {
			return
		}

		const topmostVideo = mediaElementRegistry?.getTopmostVideo()
		const framePalette = topmostVideo ? sampleVideoFramePalette(topmostVideo) : null
		const fallbackPalette = framePalette ?? createPaletteFromHex(String(selectedClip$.color.get() ?? '#2563eb'))
		if (!fallbackPalette) {
			setPaletteStatus('unavailable')
			return
		}

		updateTextStyle({ color: fallbackPalette.textColor, backgroundColor: fallbackPalette.backgroundColor })
		setPaletteStatus(framePalette ? 'frame' : 'fallback')
	}
	const effectIds = selectedClipRels$.effects.get()
	const effects = Array.isArray(effectIds) ? effectIds : []
	const effectEntries = effects
		.map((effectId) => {
			const effect$ = projects$.entitiesById[effectId]
			if (!effect$) {
				return null
			}
			const attrs = effectAttrs$(projects$, effectId)

			return {
				id: effectId,
				name: String(attrs.name.get()),
				kind: String(attrs.kind.get()),
			}
		})
		.filter((entry): entry is { id: string, name: string, kind: string } => entry !== null)

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Edit inspector">
			{text ? (
				<InspectorSection title="Text" icon={SlidersHorizontal} ariaLabel="Text controls">
					<TextAppearancePanel
						text={text}
						paletteStatus={paletteStatus}
						onContentChange={(content) => actions.updateSelectedText({ content })}
						onStyleChange={updateTextStyle}
						onGenerateFramePalette={applyFramePalette}
					/>
				</InspectorSection>
			) : null}
			<InspectorSection title="Opacity" icon={Gauge}>
				<label className="ve-slider-field">
					<span>Opacity</span>
					<input
						type="range"
						min="0"
						max="100"
						step="10"
						value={opacityPercent}
						onChange={(event) => actions.updateSelectedClipOpacity(Number(event.currentTarget.value))}
					/>
				</label>
				<small>Opacity {formatPercent(opacity)}</small>
			</InspectorSection>
			<InspectorSection title="Fade" icon={Gauge} ariaLabel="Fade controls">
				<dl className="ve-inspector-grid">
					<div>
						<dt>Fade in</dt>
						<dd>{formatSeconds(fadeIn)}</dd>
					</div>
					<div>
						<dt>Fade out</dt>
						<dd>{formatSeconds(fadeOut)}</dd>
					</div>
				</dl>
				<div className="ve-button-grid">
					<Button type="button" variant="secondary" onClick={() => actions.updateSelectedClipFade('in', 0.5)}>Fade in +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => actions.updateSelectedClipFade('in', -0.5)} disabled={fadeIn <= 0}>Fade in -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => actions.updateSelectedClipFade('out', 0.5)}>Fade out +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => actions.updateSelectedClipFade('out', -0.5)} disabled={fadeOut <= 0}>Fade out -0.5s</Button>
				</div>
			</InspectorSection>
			<InspectorSection title="Trim" icon={Scissors} ariaLabel="Trim controls">
				<div className="ve-button-grid">
					<Button type="button" variant="secondary" onClick={() => actions.trimSelectedClip('start', 0.5)}>Start +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => actions.trimSelectedClip('start', -0.5)} disabled={start <= 0}>Start -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => actions.trimSelectedClip('end', -0.5)} disabled={duration <= 0.5}>End -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => actions.trimSelectedClip('end', 0.5)}>End +0.5s</Button>
				</div>
				<small>In {formatSeconds(inPoint)}</small>
			</InspectorSection>
			<InspectorSection title="Transform" icon={Move} ariaLabel="Transform controls">
				<div className="ve-field-grid">
					<label><span>X</span><input type="number" value={transform.x.value} onChange={(event) => actions.updateSelectedClipTransform({ x: Number(event.currentTarget.value) })} /></label>
					<label><span>Y</span><input type="number" value={transform.y.value} onChange={(event) => actions.updateSelectedClipTransform({ y: Number(event.currentTarget.value) })} /></label>
					<label><span>Scale</span><input type="number" step="0.1" min="0.1" value={transform.scale.value} onChange={(event) => actions.updateSelectedClipTransform({ scale: Number(event.currentTarget.value) })} /></label>
					<label><span>Rotate</span><input type="number" value={transform.rotation.value} onChange={(event) => actions.updateSelectedClipTransform({ rotation: Number(event.currentTarget.value) })} /></label>
				</div>
			</InspectorSection>
			<InspectorSection title="Effects" icon={Sparkles} ariaLabel="Effects editor">
				<div className="ve-button-grid">
					<IconButton type="button" icon={Wand2} label="Blur" variant="secondary" onClick={() => actions.addEffectToSelectedClip('blur')}>Blur</IconButton>
					<IconButton type="button" icon={Wand2} label="Sharpen" variant="secondary" onClick={() => actions.addEffectToSelectedClip('sharpen')}>Sharpen</IconButton>
					<IconButton type="button" icon={Wand2} label="Tint" variant="secondary" onClick={() => actions.addEffectToSelectedClip('tint')}>Tint</IconButton>
				</div>
				<div className="ve-effects-toolbar">
					<small>{effects.length} effects</small>
					{effectEntries.length > 0 ? (
						<div className="ve-effects-menu">
							<IconButton
								type="button"
								className="ve-effects-menu__trigger"
								icon={SlidersHorizontal}
								aria-label="Manage effects"
								label="Manage effects"
								variant="outline"
								aria-expanded={isEffectsMenuOpen}
								onClick={() => setIsEffectsMenuOpen((value) => !value)}
							>
								Manage
							</IconButton>
							{isEffectsMenuOpen ? (
								<ul className="ve-effects-menu__list" aria-label="Active effects">
									{effectEntries.map((effect) => (
										<li key={effect.id}>
											<span>{effect.name} ({effect.kind})</span>
											<IconButton
												type="button"
												className="ve-effects-menu__remove"
												icon={X}
												aria-label={`Remove effect ${effect.name}`}
												label={`Remove effect ${effect.name}`}
												variant="ghost"
												onClick={() => {
													actions.removeEffectFromSelectedClip(effect.id)
													if (effectEntries.length <= 1) {
														setIsEffectsMenuOpen(false)
													}
												}}
											/>
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}
				</div>
			</InspectorSection>
		</div>
	)
})

const InspectorColorTabPanel = observer(({ clipId, mediaElementRegistry }: { clipId: string, mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const [isComparePressed, setIsComparePressed] = useState(false)
	const [lookThumbnails, setLookThumbnails] = useState<Record<string, string>>({})
	const compareRestoreEnabledRef = useRef<boolean | null>(null)
	const { projects$, actions } = useVideoEditor()
	const selectedClip$ = clipAttrs$(projects$, clipId)
	const selectedClipRels$ = clipRels$(projects$, clipId)
	const color = String(selectedClip$.color.get() ?? '#2563eb')
	const effectIds = selectedClipRels$.effects.get()
	const colorCorrectionEffectId = (Array.isArray(effectIds) ? effectIds : []).find((effectId) =>
		String(effectAttrs$(projects$, effectId).kind.get()) === 'color-correction')
	const colorCorrectionAttrs = colorCorrectionEffectId
		? effectAttrs$(projects$, colorCorrectionEffectId).get() as unknown as EffectAttrs
		: null
	const colorParams = (colorCorrectionAttrs?.params ?? {}) as Partial<ColorCorrectionAttrs>
	const isColorCorrectionEnabled = colorCorrectionAttrs?.enabled !== false
	const activeLookId = typeof (colorParams as Record<string, unknown>).lookId === 'string'
		? String((colorParams as Record<string, unknown>).lookId)
		: 'clean'
	const getParamValue = (key: ColorParamKey, fallback: number): number =>
		Number((colorParams[key] as AnimatedScalar | undefined)?.value ?? fallback)
	const updateColorParams = (params: Partial<Record<ColorParamKey, number>> & Record<string, unknown> = {}): void => {
		if (!colorCorrectionEffectId) {
			return
		}

		const nextParams: Record<string, unknown> = {
			...colorParams,
		}
		for (const [key, value] of Object.entries(params)) {
			nextParams[key] = typeof value === 'number' ? { value } : value
		}

		actions.updateEffectAttrs(colorCorrectionEffectId, {
			params: {
				...nextParams,
			},
		})
	}

	const updateParam = (key: PrimaryColorParam, value: number): void => {
		updateColorParams({ [key]: value, lookId: 'custom' })
	}

	const activeLook = getLookPreset(activeLookId)
	const lookIntensity = Number(((colorParams as Record<string, { value?: unknown }>).lookIntensity)?.value ?? 1)
	const applyLook = (nextLookId: string, nextIntensity = lookIntensity): void => {
		updateColorParams(buildLookColorCorrectionParams(nextLookId, nextIntensity))
	}
	const updateLookIntensity = (value: number): void => {
		if (activeLookId === 'custom' || activeLook.id === 'clean') {
			return
		}

		applyLook(activeLook.id, value)
	}

	const toggleBypass = (): void => {
		if (!colorCorrectionEffectId) {
			return
		}

		actions.updateEffectAttrs(colorCorrectionEffectId, {
			enabled: !isColorCorrectionEnabled,
		})
	}

	const resetGrade = (): void => {
		updateColorParams({
			lookId: 'clean',
			lookIntensity: 1,
			exposure: defaultColorCorrectionParams.exposure.value,
			contrast: defaultColorCorrectionParams.contrast.value,
			saturation: defaultColorCorrectionParams.saturation.value,
			temperature: defaultColorCorrectionParams.temperature.value,
			hue: 0,
			gamma: 1,
		})
	}

	const handleCompareStart = (): void => {
		if (!colorCorrectionEffectId || !isColorCorrectionEnabled || isComparePressed) {
			return
		}

		compareRestoreEnabledRef.current = isColorCorrectionEnabled
		setIsComparePressed(true)
		actions.updateEffectAttrs(colorCorrectionEffectId, { enabled: false })
	}

	const handleCompareEnd = (): void => {
		if (!colorCorrectionEffectId || !isComparePressed) {
			return
		}

		const shouldRestoreEnabled = compareRestoreEnabledRef.current
		compareRestoreEnabledRef.current = null
		setIsComparePressed(false)
		actions.updateEffectAttrs(colorCorrectionEffectId, { enabled: shouldRestoreEnabled !== false })
	}

	useEffect(() => {
		if (!colorCorrectionEffectId || !mediaElementRegistry) {
			setLookThumbnails({})
			return
		}

		const video = mediaElementRegistry.getTopmostVideo()
		const frame = video ? readVideoFrameImageData(video, 48) : null
		if (!frame) {
			setLookThumbnails({})
			return
		}

		let isCancelled = false
		const worker = new LookThumbnailWorker()
		worker.onmessage = (event: MessageEvent<{ type: string, thumbnails?: Record<string, string> }>) => {
			if (!isCancelled && event.data.type === 'look-thumbnails-rendered' && event.data.thumbnails) {
				setLookThumbnails(event.data.thumbnails)
			}
		}
		const pixels = new Uint8ClampedArray(frame.data)
		worker.postMessage({
			type: 'render-look-thumbnails',
			width: frame.width,
			height: frame.height,
			pixels,
			looks: lookPresets.map((look) => {
				const { lookId: _lookId, lookIntensity: _lookIntensity, ...params } = buildLookColorCorrectionParams(look.id, lookIntensity)
				return { id: look.id, params }
			}),
		}, [pixels.buffer])

		return () => {
			isCancelled = true
			worker.terminate()
		}
	}, [colorCorrectionEffectId, lookIntensity, mediaElementRegistry])

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Color inspector">
			<InspectorSection title="Label color" icon={Palette}>
				<label className="ve-color-field">
					<span>Clip label</span>
					<input type="color" aria-label="Color" value={color} onChange={(event) => actions.colorSelectedClip(event.currentTarget.value)} />
				</label>
				<div className="ve-swatch-grid" aria-label="Color presets">
					{['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#7c3aed', '#0891b2'].map((swatch) => (
						<button key={swatch} type="button" aria-label={`Set color ${swatch}`} style={{ background: swatch }} onClick={() => actions.colorSelectedClip(swatch)} />
					))}
				</div>
			</InspectorSection>
			<InspectorSection title="Primary correction" icon={SlidersHorizontal} ariaLabel="Primary color correction">
				{colorCorrectionEffectId ? (
					<>
						<div className="ve-color-grade-actions">
							<Button type="button" variant="secondary" onClick={toggleBypass}>
								{isColorCorrectionEnabled ? 'Bypass grade' : 'Enable grade'}
							</Button>
							<Button type="button" variant="outline" onClick={resetGrade}>Reset grade</Button>
							<Button
								type="button"
								variant="ghost"
								onPointerDown={handleCompareStart}
								onPointerUp={handleCompareEnd}
								onPointerLeave={handleCompareEnd}
								onBlur={handleCompareEnd}
							>
								Press and hold: Before
							</Button>
						</div>
						<div className="ve-color-grade-presets" aria-label="Grade presets">
							{colorGradePresets.map((preset) => (
								<Button
									key={preset.id}
									type="button"
									variant="outline"
									onClick={() => updateColorParams({ ...preset.params, lookId: 'custom', lookIntensity: 1 })}
								>
									{preset.label}
								</Button>
							))}
						</div>
						<LookBrowser
							activeLookId={activeLookId}
							intensity={lookIntensity}
							thumbnails={lookThumbnails}
							onApplyLook={applyLook}
							onIntensityChange={updateLookIntensity}
						/>
						<label className="ve-slider-field">
							<span>Exposure</span>
							<input type="range" aria-label="Exposure" min="-100" max="100" value={Math.round(getParamValue('exposure', 0) * 100)} onChange={(event) => updateParam('exposure', Number(event.currentTarget.value) / 100)} />
						</label>
						<label className="ve-slider-field">
							<span>Contrast</span>
							<input type="range" aria-label="Contrast" min="0" max="200" value={Math.round(getParamValue('contrast', 1) * 100)} onChange={(event) => updateParam('contrast', Number(event.currentTarget.value) / 100)} />
						</label>
						<label className="ve-slider-field">
							<span>Saturation</span>
							<input type="range" aria-label="Saturation" min="0" max="250" value={Math.round(getParamValue('saturation', 1) * 100)} onChange={(event) => updateParam('saturation', Number(event.currentTarget.value) / 100)} />
						</label>
						<label className="ve-slider-field">
							<span>Temperature</span>
							<input type="range" aria-label="Temperature" min="-100" max="100" value={Math.round(getParamValue('temperature', 0) * 100)} onChange={(event) => updateParam('temperature', Number(event.currentTarget.value) / 100)} />
						</label>
						<small>{isColorCorrectionEnabled ? 'Grade active' : 'Grade bypassed'} · Exposure {getParamValue('exposure', 0).toFixed(2)} · Contrast {getParamValue('contrast', 1).toFixed(2)} · Saturation {getParamValue('saturation', 1).toFixed(2)}</small>
					</>
				) : (
					<Button type="button" variant="secondary" onClick={() => actions.addColorCorrectionToSelectedClip()}>Add primary correction</Button>
				)}
			</InspectorSection>
		</div>
	)
})

const InspectorAudioTabPanel = observer(({ clipId }: { clipId: string }) => {
	const { projects$, actions } = useVideoEditor()
	const selectedClip$ = clipAttrs$(projects$, clipId)
	const selectedClipRels$ = clipRels$(projects$, clipId)
	const audio = selectedClip$.audio.get()
	const resourceId = selectedClipRels$.resource.get()
	const resourceKind = typeof resourceId === 'string'
		? (resourceAttrs$(projects$, resourceId).kind.get() as ResourceAttrs['kind'])
		: 'image'
	const selectedMediaKind = selectedClip$.mediaKind.get() ?? resourceKind
	const isAudioClip = selectedMediaKind === 'audio'

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Audio inspector">
			<InspectorSection title="Clip audio" icon={Volume2}>
				<label className="ve-slider-field">
					<span>Gain</span>
					<input
						type="range"
						aria-label="Gain"
						min="0"
						max="150"
						value={Math.round((audio?.gain ?? 1) * 100)}
						disabled={!isAudioClip}
						onChange={(event) => actions.updateSelectedClipAudio({ gain: Number(event.currentTarget.value) / 100 })}
					/>
				</label>
				<p className="ve-preview__summary">{isAudioClip ? `Gain ${Math.round((audio?.gain ?? 1) * 100)}%` : 'Select an audio clip to edit playback settings.'}</p>
			</InspectorSection>
		</div>
	)
})

const InspectorExportTabPanel = observer(({ clipId }: { clipId: string }) => {
	const [exportStatus, setExportStatus] = useState<ExportStatus>({ state: 'idle' })
	const { projects$, actions } = useVideoEditor()
	const name = String(clipAttrs$(projects$, clipId).name.get())

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Export inspector">
			<InspectorSection title="Clip export" icon={Download}>
				<dl className="ve-inspector-grid">
					<div><dt>Range</dt><dd>Clip</dd></div>
					<div><dt>Format</dt><dd>MP4</dd></div>
					<div><dt>Quality</dt><dd>High</dd></div>
				</dl>
				<IconButton
					type="button"
					icon={Download}
					label="Queue clip export"
					variant="default"
					disabled={exportStatus.state === 'rendering'}
					onClick={() => {
						setExportStatus({ state: 'rendering', progress: { stage: 'queued', progress: 0 } })
						actions.queueSelectedClipExport((progress) => {
							setExportStatus((current) => current.state === 'rendering'
								? { state: 'rendering', progress }
								: current)
						}).then((result) => {
							setExportStatus(result
								? { state: 'ready', result }
								: { state: 'error', message: 'Select a clip before exporting.' })
						}).catch((error: unknown) => {
							setExportStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
						})
					}}
				>
					{exportStatus.state === 'rendering'
						? `Rendering ${formatExportProgress(exportStatus.progress)}`
						: 'Queue clip export'}
				</IconButton>
				{exportStatus.state === 'rendering' ? (
					<p className="ve-preview__summary" aria-live="polite">
						Rendering export file for {name}: {formatExportProgress(exportStatus.progress)}
					</p>
				) : null}
				{exportStatus.state === 'ready' ? (
					<p className="ve-preview__summary" role="status">
						Export ready: {exportStatus.result.frameCount} frames · {exportStatus.result.size} bytes
						{exportStatus.result.downloadUrl ? (
							<> · <a href={exportStatus.result.downloadUrl} download={exportStatus.result.fileName}>Download file</a></>
						) : null}
					</p>
				) : null}
				{exportStatus.state === 'error' ? (
					<p className="ve-preview__summary" role="status">Export failed: {exportStatus.message}</p>
				) : null}
			</InspectorSection>
		</div>
	)
})

export const Inspector = observer(({ mediaElementRegistry }: { mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const { projects$, session$ } = useVideoEditor()
	const activeTab = session$.activeInspectorTab.get()
	const setActiveTab = (tab: InspectorTab): void => session$.activeInspectorTab.set(tab)
	const activeProjectId = getActiveProjectId$(projects$, session$)
	const selectedEntityId = session$.selectedEntityId.get()
	const selectedEntity$ = activeProjectId && selectedEntityId
		? projects$.entitiesById[selectedEntityId]
		: null
	const isClip = selectedEntity$?.type.get() === 'clip'

	if (!selectedEntity$ || !isClip) {
		return (
			<aside className="ve-panel" aria-label="Inspector">
				<div className="ve-panel__header">
					<h2>Inspector</h2>
				</div>
				<InspectorTabs activeTab={activeTab} onChange={setActiveTab} disabled />
				<p className="ve-empty">Select a clip to edit opacity or split it.</p>
			</aside>
		)
	}

	const clipId = String(selectedEntityId)

	return (
		<aside className="ve-panel" aria-label="Inspector">
			<div className="ve-panel__header">
				<h2>Inspector</h2>
				<span className="ve-inspector-status">clip selected</span>
			</div>
			<InspectorTabs activeTab={activeTab} onChange={setActiveTab} />
			<InspectorClipHeader clipId={clipId} />
			{activeTab === 'edit' ? <InspectorEditTabPanel clipId={clipId} mediaElementRegistry={mediaElementRegistry} /> : null}
			{activeTab === 'color' ? <InspectorColorTabPanel clipId={clipId} mediaElementRegistry={mediaElementRegistry} /> : null}
			{activeTab === 'audio' ? <InspectorAudioTabPanel clipId={clipId} /> : null}
			{activeTab === 'export' ? <InspectorExportTabPanel clipId={clipId} /> : null}
		</aside>
	)
})
