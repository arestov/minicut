import { useState, type ReactNode } from 'react'
import { observer } from '@legendapp/state/react'
import type { LucideIcon } from 'lucide-react'
import { Download, Gauge, Move, Palette, Scissors, SlidersHorizontal, Sparkles, Trash2, Volume2, Wand2, X } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ExportRenderResult } from '../render/exportRenderer'
import { Button, IconButton } from './ControlPrimitives'
import { formatPercent, formatSeconds } from './format'

type InspectorTab = 'edit' | 'color' | 'audio' | 'export'

type ExportStatus =
	| { state: 'idle' }
	| { state: 'rendering' }
	| { state: 'ready'; result: ExportRenderResult }
	| { state: 'error'; message: string }

const inspectorTabs: Array<{ id: InspectorTab, label: string }> = [
	{ id: 'edit', label: 'Edit' },
	{ id: 'color', label: 'Color' },
	{ id: 'audio', label: 'Audio' },
	{ id: 'export', label: 'Export' },
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

export const Inspector = observer(() => {
	const [activeTab, setActiveTab] = useState<InspectorTab>('edit')
	const [isEffectsMenuOpen, setIsEffectsMenuOpen] = useState(false)
	const [exportStatus, setExportStatus] = useState<ExportStatus>({ state: 'idle' })
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
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

	const name = String(selectedEntity$.attrs.name.get())
	const colorRaw = selectedEntity$.attrs.get()
	const color = (colorRaw && typeof (colorRaw as Record<string, unknown>).color === 'string')
		? (colorRaw as Record<string, unknown>).color as string
		: '#2563eb'
	const start = Number(selectedEntity$.attrs.start.get())
	const duration = Number(selectedEntity$.attrs.duration.get())
	const opacity = Number(selectedEntity$.attrs.opacity.value.get())
	const inPoint = Number(selectedEntity$.attrs.in.get())
	const fadeIn = Number(selectedEntity$.attrs.fadeIn.get() ?? 0)
	const fadeOut = Number(selectedEntity$.attrs.fadeOut.get() ?? 0)
	const transform = selectedEntity$.attrs.transform.get() as {
		x: { value: number }
		y: { value: number }
		scale: { value: number }
		rotation: { value: number }
	}
	const effectIds = selectedEntity$.rels.effects.get()
	const effects = Array.isArray(effectIds) ? effectIds : []
	const effectEntries = effects
		.map((effectId) => {
			const effect$ = projects$.entitiesById[effectId]
			if (!effect$) {
				return null
			}

			return {
				id: effectId,
				name: String(effect$.attrs.name.get()),
				kind: String(effect$.attrs.kind.get()),
			}
		})
		.filter((entry): entry is { id: string, name: string, kind: string } => entry !== null)
	const opacityPercent = Math.round(opacity * 100)
	let selectedTrackName = 'Track'
	let selectedClipOrdinal = 1
	if (activeProjectId && selectedEntityId) {
		const rootEntityId = projects$.projects[activeProjectId]?.rootEntityId.get()
		const timelineId = rootEntityId ? projects$.entitiesById[rootEntityId].rels.activeTimeline.get() : null
		const trackIds = typeof timelineId === 'string'
			? projects$.entitiesById[timelineId].rels.tracks.get()
			: []

		if (Array.isArray(trackIds)) {
			for (const trackId of trackIds) {
				const clipIds = projects$.entitiesById[trackId].rels.clips.get()
				if (!Array.isArray(clipIds)) {
					continue
				}

				const clipIndex = clipIds.indexOf(selectedEntityId)
				if (clipIndex >= 0) {
					selectedTrackName = String(projects$.entitiesById[trackId].attrs.name.get())
					selectedClipOrdinal = clipIndex + 1
					break
				}
			}
		}
	}

	return (
		<aside className="ve-panel" aria-label="Inspector">
			<div className="ve-panel__header">
				<h2>Inspector</h2>
				<span className="ve-inspector-status">clip selected</span>
			</div>
			<InspectorTabs activeTab={activeTab} onChange={setActiveTab} />
			<div className="ve-inspector-selected">
				<div className="ve-inspector-thumb" style={{ background: color }} />
				<div>
					<strong>{name}</strong>
					<small>Clip {selectedClipOrdinal} - {selectedTrackName} - {formatSeconds(start)}</small>
				</div>
			</div>
			{activeTab === 'edit' ? (
				<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Edit inspector">
					<InspectorSection title="Basic" icon={SlidersHorizontal}>
						<label className="ve-inspector-field">
							<span>Clip name</span>
							<input
								className="ve-inspector-name"
								type="text"
								aria-label="Clip name"
								value={name}
								onChange={(event) => actions.renameSelectedClip(event.currentTarget.value)}
							/>
						</label>
						<dl className="ve-inspector-grid">
							<div>
								<dt>Start</dt>
								<dd>{formatSeconds(start)}</dd>
							</div>
							<div>
								<dt>Duration</dt>
								<dd>{formatSeconds(duration)}</dd>
							</div>
							<div>
								<dt>Opacity</dt>
								<dd>{formatPercent(opacity)}</dd>
							</div>
						</dl>
					</InspectorSection>
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
					<div className="ve-inline-actions">
						<IconButton type="button" icon={Scissors} label="Split clip" variant="outline" onClick={() => actions.splitSelectedClip()}>Split clip</IconButton>
						<IconButton type="button" icon={Move} label="Nudge +0.5s" variant="outline" onClick={() => actions.nudgeSelectedClip(0.5)}>Nudge +0.5s</IconButton>
						<IconButton type="button" icon={Trash2} label="Delete clip" variant="destructive" onClick={() => actions.deleteSelectedClip()}>Delete clip</IconButton>
					</div>
				</div>
			) : null}
			{activeTab === 'color' ? (
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
				</div>
			) : null}
			{activeTab === 'audio' ? (
				<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Audio inspector">
					<InspectorSection title="Clip audio" icon={Volume2}>
						<label className="ve-slider-field"><span>Gain</span><input type="range" min="0" max="150" value="100" readOnly /></label>
						<label className="ve-slider-field"><span>Pan</span><input type="range" min="-100" max="100" value="0" readOnly /></label>
						<p className="ve-preview__summary">Audio controls are scoped to the selected clip state.</p>
					</InspectorSection>
				</div>
			) : null}
			{activeTab === 'export' ? (
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
								setExportStatus({ state: 'rendering' })
								actions.queueSelectedClipExport().then((result) => {
									setExportStatus(result
										? { state: 'ready', result }
										: { state: 'error', message: 'Select a clip before exporting.' })
								}).catch((error: unknown) => {
									setExportStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
								})
							}}
						>
							{exportStatus.state === 'rendering' ? 'Rendering export' : 'Queue clip export'}
						</IconButton>
						{exportStatus.state === 'rendering' ? (
							<p className="ve-preview__summary" role="status">Rendering export file for {name}</p>
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
			) : null}
		</aside>
	)
})
