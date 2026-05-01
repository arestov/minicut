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
			<div className="ve-inline-actions">
				<button type="button" onClick={() => actions.splitSelectedClip()}>
					Split clip
				</button>
				<button type="button" onClick={() => actions.nudgeSelectedClip(0.5)}>
					Nudge +0.5s
				</button>
			</div>
		</aside>
	)
})
