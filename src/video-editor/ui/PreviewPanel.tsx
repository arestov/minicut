import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getActiveClipNamesAtCursor } from '../domain/selectors'
import { formatSeconds } from './format'

export const PreviewPanel = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const session = session$.get()
	const activeClipNames = getActiveClipNamesAtCursor(projects$.get(), session)

	return (
		<section className="ve-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
				<button type="button" onClick={() => actions.togglePlayback()}>
					{session.isPlaying ? 'Pause' : 'Play'}
				</button>
			</div>
			<label className="ve-slider-field">
				<span>Cursor</span>
				<input
					type="range"
					min="0"
					max="20"
					step="0.5"
					value={session.cursor}
					onChange={(event) => actions.setCursor(Number(event.currentTarget.value))}
				/>
			</label>
			<p className="ve-preview__summary">Cursor at {formatSeconds(session.cursor)}</p>
			<p className="ve-preview__summary">
				Active clips at cursor: {activeClipNames.length > 0 ? activeClipNames.join(', ') : 'none'}
			</p>
		</section>
	)
})
