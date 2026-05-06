import { Gauge, Move, Scissors, SlidersHorizontal, Sparkles, Wand2, X } from 'lucide-react'
import { useState } from 'react'
import { ScopeContext } from '../../../dkt-react-sync/context/ScopeContext'
import { useAttrs } from '../../../dkt-react-sync/hooks/useAttrs'
import { useMany } from '../../../dkt-react-sync/hooks/useMany'
import { useOne } from '../../../dkt-react-sync/hooks/useOne'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { createPaletteFromHex, sampleVideoFramePalette } from '../../color/framePalette'
import type { TextAttrs } from '../../models/Text/types'
import type { TransformAttrs } from '../../models/Clip/types'
import { Button, IconButton } from '../ControlPrimitives'
import { formatPercent, formatSeconds } from '../format'
import type { FramePaletteStatus } from '../FramePaletteAction'
import type { PreviewMediaElementRegistry } from '../mediaElementRegistry'
import { TextAppearancePanel } from '../TextAppearancePanel'
import { InspectorSection } from './InspectorSection'
import type { ClipRenderAttrs, TextRenderAttrs } from './types'
import { getTextAttrs } from './types'

const EffectEntry = ({ onRemove }: { onRemove: (effectId: string) => void }) => {
	const attrs = useAttrs(['sourceEffectId', 'name', 'kind']) as { sourceEffectId?: unknown; name?: unknown; kind?: unknown }
	const effectId = typeof attrs.sourceEffectId === 'string' ? attrs.sourceEffectId : null
	const name = String(attrs.name)
	const kind = String(attrs.kind)

	return (
		<li>
			<span>{name} ({kind})</span>
			<IconButton type="button" className="ve-effects-menu__remove" icon={X} aria-label={`Remove effect ${name}`} label={`Remove effect ${name}`} variant="ghost" disabled={!effectId} onClick={() => effectId ? onRemove(effectId) : undefined} />
		</li>
	)
}

const TransformFields = ({ transform, onChange }: {
	transform: TransformAttrs
	onChange: (patch: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>) => void
}) => (
	<div className="ve-field-grid">
		<label><span>X</span><input type="number" value={transform.x.value} onChange={(event) => onChange({ x: Number(event.currentTarget.value) })} /></label>
		<label><span>Y</span><input type="number" value={transform.y.value} onChange={(event) => onChange({ y: Number(event.currentTarget.value) })} /></label>
		<label><span>Scale</span><input type="number" step="0.1" min="0.1" value={transform.scale.value} onChange={(event) => onChange({ scale: Number(event.currentTarget.value) })} /></label>
		<label><span>Rotate</span><input type="number" value={transform.rotation.value} onChange={(event) => onChange({ rotation: Number(event.currentTarget.value) })} /></label>
	</div>
)

const TextEditorSection = ({ clipColor, mediaElementRegistry }: { clipColor: string; mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const { actions } = useVideoEditor()
	const [paletteStatus, setPaletteStatus] = useState<FramePaletteStatus>('idle')
	const textAttrs = useAttrs(['sourceTextId', 'content', 'style', 'box']) as TextRenderAttrs & { sourceTextId?: unknown }
	const sourceTextId = typeof textAttrs.sourceTextId === 'string' ? textAttrs.sourceTextId : null
	const text = getTextAttrs(textAttrs)

	if (!text || !sourceTextId) {
		return null
	}

	const updateTextStyle = (style: Partial<TextAttrs['style']>): void => {
		actions.updateTextById(sourceTextId, { style: { ...text.style, ...style } })
	}
	const applyFramePalette = (): void => {
		const topmostVideo = mediaElementRegistry?.getTopmostVideo()
		const framePalette = topmostVideo ? sampleVideoFramePalette(topmostVideo) : null
		const fallbackPalette = framePalette ?? createPaletteFromHex(clipColor)
		if (!fallbackPalette) {
			setPaletteStatus('unavailable')
			return
		}

		updateTextStyle({ color: fallbackPalette.textColor, backgroundColor: fallbackPalette.backgroundColor })
		setPaletteStatus(framePalette ? 'frame' : 'fallback')
	}

	return (
		<InspectorSection title="Text" icon={SlidersHorizontal} ariaLabel="Text controls">
			<TextAppearancePanel
				text={text}
				paletteStatus={paletteStatus}
				onContentChange={(content) => actions.updateTextById(sourceTextId, { content })}
				onStyleChange={updateTextStyle}
				onGenerateFramePalette={applyFramePalette}
			/>
		</InspectorSection>
	)
}

export const InspectorEditTabPanel = ({ mediaElementRegistry }: { mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const [isEffectsMenuOpen, setIsEffectsMenuOpen] = useState(false)
	const { actions } = useVideoEditor()
	const attrs = useAttrs(['sourceClipId', 'opacity', 'in', 'fadeIn', 'fadeOut', 'duration', 'start', 'transform', 'color']) as ClipRenderAttrs & { sourceClipId?: unknown }
	const textScope = useOne('text')
	const effectScopes = useMany('effects')
	const sourceClipId = typeof attrs.sourceClipId === 'string' ? attrs.sourceClipId : null
	const opacity = Number(attrs.opacity?.value ?? 1)
	const opacityPercent = Math.round(opacity * 100)
	const inPoint = Number(attrs.in)
	const fadeIn = Number(attrs.fadeIn ?? 0)
	const fadeOut = Number(attrs.fadeOut ?? 0)
	const duration = Number(attrs.duration)
	const start = Number(attrs.start)
	const color = String(attrs.color ?? '#2563eb')
	const transform = attrs.transform ?? { x: { value: 0 }, y: { value: 0 }, scale: { value: 1 }, rotation: { value: 0 } }
	const updateClip = (fn: (clipId: string) => void): void => {
		if (sourceClipId) {
			fn(sourceClipId)
		}
	}

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Edit inspector">
			{textScope ? (
				<ScopeContext.Provider value={textScope}>
					<TextEditorSection clipColor={color} mediaElementRegistry={mediaElementRegistry} />
				</ScopeContext.Provider>
			) : null}
			<InspectorSection title="Opacity" icon={Gauge}>
				<label className="ve-slider-field">
					<span>Opacity</span>
					<input type="range" min="0" max="100" step="10" value={opacityPercent} onChange={(event) => updateClip((clipId) => actions.updateClipOpacityById(clipId, Number(event.currentTarget.value)))} />
				</label>
				<small>Opacity {formatPercent(opacity)}</small>
			</InspectorSection>
			<InspectorSection title="Fade" icon={Gauge} ariaLabel="Fade controls">
				<dl className="ve-inspector-grid">
					<div><dt>Fade in</dt><dd>{formatSeconds(fadeIn)}</dd></div>
					<div><dt>Fade out</dt><dd>{formatSeconds(fadeOut)}</dd></div>
				</dl>
				<div className="ve-button-grid">
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.updateClipFadeById(clipId, 'in', 0.5))}>Fade in +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.updateClipFadeById(clipId, 'in', -0.5))} disabled={fadeIn <= 0}>Fade in -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.updateClipFadeById(clipId, 'out', 0.5))}>Fade out +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.updateClipFadeById(clipId, 'out', -0.5))} disabled={fadeOut <= 0}>Fade out -0.5s</Button>
				</div>
			</InspectorSection>
			<InspectorSection title="Trim" icon={Scissors} ariaLabel="Trim controls">
				<div className="ve-button-grid">
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.trimClipById(clipId, 'start', 0.5))}>Start +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.trimClipById(clipId, 'start', -0.5))} disabled={start <= 0}>Start -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.trimClipById(clipId, 'end', -0.5))} disabled={duration <= 0.5}>End -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => updateClip((clipId) => actions.trimClipById(clipId, 'end', 0.5))}>End +0.5s</Button>
				</div>
				<small>In {formatSeconds(inPoint)}</small>
			</InspectorSection>
			<InspectorSection title="Transform" icon={Move} ariaLabel="Transform controls">
				<TransformFields transform={transform} onChange={(patch) => updateClip((clipId) => actions.updateClipTransformById(clipId, patch))} />
			</InspectorSection>
			<InspectorSection title="Effects" icon={Sparkles} ariaLabel="Effects editor">
				<div className="ve-button-grid">
					<IconButton type="button" icon={Wand2} label="Blur" variant="secondary" onClick={() => updateClip((clipId) => actions.addEffectToClip(clipId, 'blur'))}>Blur</IconButton>
					<IconButton type="button" icon={Wand2} label="Sharpen" variant="secondary" onClick={() => updateClip((clipId) => actions.addEffectToClip(clipId, 'sharpen'))}>Sharpen</IconButton>
					<IconButton type="button" icon={Wand2} label="Tint" variant="secondary" onClick={() => updateClip((clipId) => actions.addEffectToClip(clipId, 'tint'))}>Tint</IconButton>
				</div>
				<div className="ve-effects-toolbar">
					<small>{effectScopes.length} effects</small>
					{effectScopes.length > 0 ? (
						<div className="ve-effects-menu">
							<IconButton type="button" className="ve-effects-menu__trigger" icon={SlidersHorizontal} aria-label="Manage effects" label="Manage effects" variant="outline" aria-expanded={isEffectsMenuOpen} onClick={() => setIsEffectsMenuOpen((value) => !value)}>Manage</IconButton>
							{isEffectsMenuOpen ? (
								<ul className="ve-effects-menu__list" aria-label="Active effects">
									{effectScopes.map((effectScope) => (
										<ScopeContext.Provider key={effectScope._nodeId} value={effectScope}>
											<EffectEntry onRemove={(effectId) => {
												updateClip((clipId) => actions.removeEffectFromClip(clipId, effectId))
												if (effectScopes.length <= 1) {
													setIsEffectsMenuOpen(false)
												}
											}} />
										</ScopeContext.Provider>
									))}
								</ul>
							) : null}
						</div>
					) : null}
				</div>
			</InspectorSection>
		</div>
	)
}

