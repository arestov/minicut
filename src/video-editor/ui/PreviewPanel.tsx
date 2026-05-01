import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatSeconds } from './format'

const getActiveClipNames = (
	projects$: ReturnType<typeof useVideoEditor>['projects$'],
	projectId: string | null,
	cursor: number,
): string[] => {
	if (!projectId) {
		return []
	}

	const project$ = projects$.projects[projectId]
	const rootEntityId = project$.rootEntityId.get()
	const timelineId = projects$.entitiesById[rootEntityId].rels.activeTimeline.get()
	if (typeof timelineId !== 'string') {
		return []
	}

	const trackIds = projects$.entitiesById[timelineId].rels.tracks.get()
	if (!Array.isArray(trackIds)) {
		return []
	}

	const activeNames: string[] = []
	for (const trackId of trackIds) {
		const clipIds = projects$.entitiesById[trackId].rels.clips.get()
		if (!Array.isArray(clipIds)) {
			continue
		}

		for (const clipId of clipIds) {
			const clip$ = projects$.entitiesById[clipId]
			const start = Number(clip$.attrs.start.get())
			const duration = Number(clip$.attrs.duration.get())
			if (cursor >= start && cursor < start + duration) {
				activeNames.push(String(clip$.attrs.name.get()))
			}
		}
	}

	return activeNames
}

export const PreviewPanel = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const cursor = session$.cursor.get()
	const isPlaying = session$.isPlaying.get()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeClipNames = getActiveClipNames(projects$, activeProjectId, cursor)

	return (
		<section className="ve-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
				<button type="button" onClick={() => actions.togglePlayback()}>
					{isPlaying ? 'Pause' : 'Play'}
				</button>
			</div>
			<label className="ve-slider-field">
				<span>Cursor</span>
				<input
					type="range"
					min="0"
					max="20"
					step="0.5"
					value={cursor}
					onChange={(event) => actions.setCursor(Number(event.currentTarget.value))}
				/>
			</label>
			<p className="ve-preview__summary">Cursor at {formatSeconds(cursor)}</p>
			<p className="ve-preview__summary">
				Active clips at cursor: {activeClipNames.length > 0 ? activeClipNames.join(', ') : 'none'}
			</p>
		</section>
	)
})
