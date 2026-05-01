import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatPercent, formatSeconds } from './format'

type InspectorTab = 'edit' | 'color' | 'audio' | 'export'

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

export const Inspector = observer(() => {
	const [activeTab, setActiveTab] = useState<InspectorTab>('edit')
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
	const transform = selectedEntity$.attrs.transform.get() as {
		x: { value: number }
		y: { value: number }
		scale: { value: number }
		rotation: { value: number }
	}
	const effectIds = selectedEntity$.rels.effects.get()
	const effects = Array.isArray(effectIds) ? effectIds : []
	const opacityPercent = Math.round(opacity * 100)

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
					<small>clip-18 - V1 - {formatSeconds(start)}</small>
				</div>
			</div>
			{activeTab === 'edit' ? (
				<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Edit inspector">
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
					<div className="ve-tool-group" aria-label="Trim controls">
						<h3>Trim</h3>
						<div className="ve-button-grid">
							<button type="button" onClick={() => actions.trimSelectedClip('start', 0.5)}>Start +0.5s</button>
							<button type="button" onClick={() => actions.trimSelectedClip('start', -0.5)} disabled={start <= 0}>Start -0.5s</button>
							<button type="button" onClick={() => actions.trimSelectedClip('end', -0.5)} disabled={duration <= 0.5}>End -0.5s</button>
							<button type="button" onClick={() => actions.trimSelectedClip('end', 0.5)}>End +0.5s</button>
						</div>
						<small>In {formatSeconds(inPoint)}</small>
					</div>
					<div className="ve-tool-group" aria-label="Transform controls">
						<h3>Transform</h3>
						<div className="ve-field-grid">
							<label><span>X</span><input type="number" value={transform.x.value} onChange={(event) => actions.updateSelectedClipTransform({ x: Number(event.currentTarget.value) })} /></label>
							<label><span>Y</span><input type="number" value={transform.y.value} onChange={(event) => actions.updateSelectedClipTransform({ y: Number(event.currentTarget.value) })} /></label>
							<label><span>Scale</span><input type="number" step="0.1" min="0.1" value={transform.scale.value} onChange={(event) => actions.updateSelectedClipTransform({ scale: Number(event.currentTarget.value) })} /></label>
							<label><span>Rotate</span><input type="number" value={transform.rotation.value} onChange={(event) => actions.updateSelectedClipTransform({ rotation: Number(event.currentTarget.value) })} /></label>
						</div>
					</div>
					<div className="ve-tool-group" aria-label="Effects editor">
						<h3>Effects</h3>
						<div className="ve-button-grid">
							<button type="button" onClick={() => actions.addEffectToSelectedClip('blur')}>Blur</button>
							<button type="button" onClick={() => actions.addEffectToSelectedClip('sharpen')}>Sharpen</button>
							<button type="button" onClick={() => actions.addEffectToSelectedClip('tint')}>Tint</button>
						</div>
						<small>{effects.length} effects</small>
					</div>
					<div className="ve-inline-actions">
						<button type="button" onClick={() => actions.splitSelectedClip()}>Split clip</button>
						<button type="button" onClick={() => actions.nudgeSelectedClip(0.5)}>Nudge +0.5s</button>
						<button type="button" onClick={() => actions.deleteSelectedClip()}>Delete clip</button>
					</div>
				</div>
			) : null}
			{activeTab === 'color' ? (
				<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Color inspector">
					<label className="ve-color-field">
						<span>Clip label</span>
						<input type="color" aria-label="Color" value={color} onChange={(event) => actions.colorSelectedClip(event.currentTarget.value)} />
					</label>
					<div className="ve-swatch-grid" aria-label="Color presets">
						{['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#7c3aed', '#0891b2'].map((swatch) => (
							<button key={swatch} type="button" aria-label={`Set color ${swatch}`} style={{ background: swatch }} onClick={() => actions.colorSelectedClip(swatch)} />
						))}
					</div>
					<p className="ve-preview__summary">The color tab changes clip identity color and timeline accents.</p>
				</div>
			) : null}
			{activeTab === 'audio' ? (
				<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Audio inspector">
					<label className="ve-slider-field"><span>Gain</span><input type="range" min="0" max="150" value="100" readOnly /></label>
					<label className="ve-slider-field"><span>Pan</span><input type="range" min="-100" max="100" value="0" readOnly /></label>
					<p className="ve-preview__summary">Audio controls are scoped to the selected clip state.</p>
				</div>
			) : null}
			{activeTab === 'export' ? (
				<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Export inspector">
					<dl className="ve-inspector-grid">
						<div><dt>Range</dt><dd>Clip</dd></div>
						<div><dt>Format</dt><dd>MP4</dd></div>
						<div><dt>Quality</dt><dd>High</dd></div>
					</dl>
					<button type="button">Queue clip export</button>
				</div>
			) : null}
		</aside>
	)
})
