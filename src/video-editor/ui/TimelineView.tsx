import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getActiveProject, getTracks } from '../domain/selectors'
import { TrackRow } from './TrackRow'

export const TimelineView = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const activeProject = getActiveProject(projects$.get(), session$.get())
	const tracks = activeProject ? getTracks(activeProject) : []

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			<div className="ve-panel__header">
				<h2>Timeline</h2>
				<span>{tracks.length} tracks</span>
			</div>
			{!activeProject ? (
				<p className="ve-empty">Create a project to allocate timeline tracks.</p>
			) : (
				<div className="ve-track-list">
					{tracks.map((track) => (
						<TrackRow key={track.id} track={track} />
					))}
				</div>
			)}
		</section>
	)
})
