import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getSelectedClip } from '../domain/selectors'
import type { ClipAttrs } from '../domain/types'
import { formatPercent, formatSeconds } from './format'

export const Inspector = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const clip = getSelectedClip(projects$.get(), session$.get())

	if (!clip) {
		return (
			<aside className="ve-panel" aria-label="Inspector">
				<div className="ve-panel__header">
					<h2>Inspector</h2>
				</div>
				<p className="ve-empty">Select a clip to edit opacity or split it.</p>
			</aside>
		)
	}

	const attrs = clip.attrs as ClipAttrs
	const opacityPercent = Math.round(attrs.opacity * 100)

	return (
		<aside className="ve-panel" aria-label="Inspector">
			<div className="ve-panel__header">
				<h2>Inspector</h2>
				<span>{String(attrs.name)}</span>
			</div>
			<dl className="ve-inspector-grid">
				<div>
					<dt>Start</dt>
					<dd>{formatSeconds(attrs.start)}</dd>
				</div>
				<div>
					<dt>Duration</dt>
					<dd>{formatSeconds(attrs.duration)}</dd>
				</div>
				<div>
					<dt>Opacity</dt>
					<dd>{formatPercent(attrs.opacity)}</dd>
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
