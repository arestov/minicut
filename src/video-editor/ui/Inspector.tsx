import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatPercent, formatSeconds } from './format'

export const Inspector = observer(() => {
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
				<p className="ve-empty">Select a clip to edit opacity or split it.</p>
			</aside>
		)
	}

	const name = String(selectedEntity$.attrs.name.get())
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
				<span>{name}</span>
			</div>
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
					<button type="button" onClick={() => actions.trimSelectedClip('start', 0.5)}>
						Start +0.5s
					</button>
					<button type="button" onClick={() => actions.trimSelectedClip('start', -0.5)} disabled={start <= 0}>
						Start -0.5s
					</button>
					<button type="button" onClick={() => actions.trimSelectedClip('end', -0.5)} disabled={duration <= 0.5}>
						End -0.5s
					</button>
					<button type="button" onClick={() => actions.trimSelectedClip('end', 0.5)}>
						End +0.5s
					</button>
				</div>
				<small>In {formatSeconds(inPoint)}</small>
			</div>
			<div className="ve-tool-group" aria-label="Transform controls">
				<h3>Transform</h3>
				<div className="ve-field-grid">
					<label>
						<span>X</span>
						<input
							type="number"
							value={transform.x.value}
							onChange={(event) => actions.updateSelectedClipTransform({ x: Number(event.currentTarget.value) })}
						/>
					</label>
					<label>
						<span>Y</span>
						<input
							type="number"
							value={transform.y.value}
							onChange={(event) => actions.updateSelectedClipTransform({ y: Number(event.currentTarget.value) })}
						/>
					</label>
					<label>
						<span>Scale</span>
						<input
							type="number"
							step="0.1"
							min="0.1"
							value={transform.scale.value}
							onChange={(event) => actions.updateSelectedClipTransform({ scale: Number(event.currentTarget.value) })}
						/>
					</label>
					<label>
						<span>Rotate</span>
						<input
							type="number"
							value={transform.rotation.value}
							onChange={(event) => actions.updateSelectedClipTransform({ rotation: Number(event.currentTarget.value) })}
						/>
					</label>
				</div>
			</div>
			<div className="ve-tool-group" aria-label="Effects editor">
				<h3>Effects</h3>
				<div className="ve-button-grid">
					<button type="button" onClick={() => actions.addEffectToSelectedClip('blur')}>
						Blur
					</button>
					<button type="button" onClick={() => actions.addEffectToSelectedClip('sharpen')}>
						Sharpen
					</button>
					<button type="button" onClick={() => actions.addEffectToSelectedClip('tint')}>
						Tint
					</button>
				</div>
				<small>{effects.length} effects</small>
			</div>
			<div className="ve-inline-actions">
				<button type="button" onClick={() => actions.splitSelectedClip()}>
					Split clip
				</button>
				<button type="button" onClick={() => actions.nudgeSelectedClip(0.5)}>
					Nudge +0.5s
				</button>
				<button type="button" onClick={() => actions.deleteSelectedClip()}>
					Delete clip
				</button>
			</div>
		</aside>
	)
})
