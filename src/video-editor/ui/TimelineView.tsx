import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { TrackRow } from './TrackRow'

export const TimelineView = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const timelineId = rootEntityId
		? activeProject$?.entities[rootEntityId].rels.activeTimeline.get()
		: null
	const trackIds =
		activeProject$ && typeof timelineId === 'string'
			? activeProject$.entities[timelineId].rels.tracks.get()
			: []
	const tracks = Array.isArray(trackIds) ? trackIds : []

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			<div className="ve-panel__header">
				<h2>Timeline</h2>
				<span>{tracks.length} tracks</span>
			</div>
			{!activeProjectId ? (
				<p className="ve-empty">Create a project to allocate timeline tracks.</p>
			) : (
				<div className="ve-track-list">
					{tracks.map((trackId) => (
						<TrackRow key={trackId} projectId={activeProjectId} trackId={trackId} />
					))}
				</div>
			)}
		</section>
	)
})
