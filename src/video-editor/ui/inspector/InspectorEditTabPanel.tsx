import { Gauge, Move, Scissors, SlidersHorizontal, Sparkles, Wand2, X } from 'lucide-react'
import { useState } from 'react'
import { createPaletteFromHex, sampleVideoFramePalette } from '../../color/framePalette'
import type { TextAttrs, TransformAttrs } from '../../domain/types'
import { EditorScopeProvider, ROOT_SCOPE, useEditorActions, useEditorAttrs, useEditorMany, useEditorOne } from '../../render-sync'
import type { EditorScope } from '../../render-sync/EditorScope'
import { Button, IconButton } from '../ControlPrimitives'
import { formatPercent, formatSeconds } from '../format'
import type { FramePaletteStatus } from '../FramePaletteAction'
import type { PreviewMediaElementRegistry } from '../mediaElementRegistry'
import { TextAppearancePanel } from '../TextAppearancePanel'
import { InspectorSection } from './InspectorSection'
import type { ClipRenderAttrs, TextRenderAttrs } from './types'
import { getTextAttrs } from './types'

const EffectEntry = ({ effectScope, onRemove }: { effectScope: EditorScope; onRemove: (effectId: string) => void }) => {
	const attrs = useEditorAttrs<{ name?: unknown, kind?: unknown }>(['name', 'kind'], effectScope)
	const name = String(attrs.name)
	const kind = String(attrs.kind)

	return (
		<li>
			<span>{name} ({kind})</span>
			<IconButton
				type="button"
				className="ve-effects-menu__remove"
				icon={X}
				aria-label={`Remove effect ${name}`}
				label={`Remove effect ${name}`}
				variant="ghost"
				onClick={() => onRemove(effectScope.nodeId)}
			/>
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

export const InspectorEditTabPanel = ({ clipScope, mediaElementRegistry }: { clipScope: EditorScope; mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const [isEffectsMenuOpen, setIsEffectsMenuOpen] = useState(false)
	const [paletteStatus, setPaletteStatus] = useState<FramePaletteStatus>('idle')
	const clipDispatch = useEditorActions(clipScope)
	const attrs = useEditorAttrs<ClipRenderAttrs>(['opacity', 'in', 'fadeIn', 'fadeOut', 'duration', 'start', 'transform', 'color'], clipScope)
	const textScope = useEditorOne('text', clipScope)
	const textAttrs = useEditorAttrs<TextRenderAttrs>(['content', 'style', 'box'], textScope ?? ROOT_SCOPE)
	const effectScopes = useEditorMany('effects', clipScope)
	const opacity = Number(attrs.opacity?.value ?? 1)
	const opacityPercent = Math.round(opacity * 100)
	const inPoint = Number(attrs.in)
	const fadeIn = Number(attrs.fadeIn ?? 0)
	const fadeOut = Number(attrs.fadeOut ?? 0)
	const duration = Number(attrs.duration)
	const start = Number(attrs.start)
	const transform = attrs.transform ?? { x: { value: 0 }, y: { value: 0 }, scale: { value: 1 }, rotation: { value: 0 } }
	const text = textScope ? getTextAttrs(textAttrs) : null
	const textDispatch = useEditorActions(textScope ?? ROOT_SCOPE)

	const updateTextStyle = (style: Partial<TextAttrs['style']>): void => {
		if (!text) {
			return
		}
		textDispatch('updateText', { style: { ...text.style, ...style } })
	}

	const applyFramePalette = (): void => {
		if (!text) {
			return
		}

		const topmostVideo = mediaElementRegistry?.getTopmostVideo()
		const framePalette = topmostVideo ? sampleVideoFramePalette(topmostVideo) : null
		const fallbackPalette = framePalette ?? createPaletteFromHex(String(attrs.color ?? '#2563eb'))
		if (!fallbackPalette) {
			setPaletteStatus('unavailable')
			return
		}

		updateTextStyle({ color: fallbackPalette.textColor, backgroundColor: fallbackPalette.backgroundColor })
		setPaletteStatus(framePalette ? 'frame' : 'fallback')
	}

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Edit inspector">
			{text ? (
				<InspectorSection title="Text" icon={SlidersHorizontal} ariaLabel="Text controls">
					<TextAppearancePanel
						text={text}
						paletteStatus={paletteStatus}
						onContentChange={(content) => textDispatch('updateText', { content })}
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
						onChange={(event) => clipDispatch('setOpacity', { opacityPercent: Number(event.currentTarget.value) })}
					/>
				</label>
				<small>Opacity {formatPercent(opacity)}</small>
			</InspectorSection>
			<InspectorSection title="Fade" icon={Gauge} ariaLabel="Fade controls">
				<dl className="ve-inspector-grid">
					<div><dt>Fade in</dt><dd>{formatSeconds(fadeIn)}</dd></div>
					<div><dt>Fade out</dt><dd>{formatSeconds(fadeOut)}</dd></div>
				</dl>
				<div className="ve-button-grid">
					<Button type="button" variant="secondary" onClick={() => clipDispatch('setFade', { edge: 'in', delta: 0.5 })}>Fade in +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => clipDispatch('setFade', { edge: 'in', delta: -0.5 })} disabled={fadeIn <= 0}>Fade in -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => clipDispatch('setFade', { edge: 'out', delta: 0.5 })}>Fade out +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => clipDispatch('setFade', { edge: 'out', delta: -0.5 })} disabled={fadeOut <= 0}>Fade out -0.5s</Button>
				</div>
			</InspectorSection>
			<InspectorSection title="Trim" icon={Scissors} ariaLabel="Trim controls">
				<div className="ve-button-grid">
					<Button type="button" variant="secondary" onClick={() => clipDispatch('trim', { edge: 'start', delta: 0.5 })}>Start +0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => clipDispatch('trim', { edge: 'start', delta: -0.5 })} disabled={start <= 0}>Start -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => clipDispatch('trim', { edge: 'end', delta: -0.5 })} disabled={duration <= 0.5}>End -0.5s</Button>
					<Button type="button" variant="secondary" onClick={() => clipDispatch('trim', { edge: 'end', delta: 0.5 })}>End +0.5s</Button>
				</div>
				<small>In {formatSeconds(inPoint)}</small>
			</InspectorSection>
			<InspectorSection title="Transform" icon={Move} ariaLabel="Transform controls">
				<TransformFields
					transform={transform}
					onChange={(patch) => clipDispatch('setTransform', patch)}
				/>
			</InspectorSection>
			<InspectorSection title="Effects" icon={Sparkles} ariaLabel="Effects editor">
				<div className="ve-button-grid">
					<IconButton type="button" icon={Wand2} label="Blur" variant="secondary" onClick={() => clipDispatch('addEffect', { kind: 'blur' })}>Blur</IconButton>
					<IconButton type="button" icon={Wand2} label="Sharpen" variant="secondary" onClick={() => clipDispatch('addEffect', { kind: 'sharpen' })}>Sharpen</IconButton>
					<IconButton type="button" icon={Wand2} label="Tint" variant="secondary" onClick={() => clipDispatch('addEffect', { kind: 'tint' })}>Tint</IconButton>
				</div>
				<div className="ve-effects-toolbar">
					<small>{effectScopes.length} effects</small>
					{effectScopes.length > 0 ? (
						<div className="ve-effects-menu">
							<IconButton type="button" className="ve-effects-menu__trigger" icon={SlidersHorizontal} aria-label="Manage effects" label="Manage effects" variant="outline" aria-expanded={isEffectsMenuOpen} onClick={() => setIsEffectsMenuOpen((value) => !value)}>Manage</IconButton>
							{isEffectsMenuOpen ? (
								<ul className="ve-effects-menu__list" aria-label="Active effects">
									{effectScopes.map((effectScope) => (
										<EditorScopeProvider key={effectScope.nodeId} scope={effectScope}>
											<EffectEntry
												effectScope={effectScope}
												onRemove={(effectId) => {
													clipDispatch('removeEffect', { effectId })
													if (effectScopes.length <= 1) {
														setIsEffectsMenuOpen(false)
													}
												}}
											/>
										</EditorScopeProvider>
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
