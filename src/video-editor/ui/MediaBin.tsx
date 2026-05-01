import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getActiveProject, getResourceEntities, getResourceLabel } from '../domain/selectors'

export const MediaBin = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const activeProject = getActiveProject(projects$.get(), session$.get())
	const resources = activeProject ? getResourceEntities(activeProject) : []

	return (
		<section className="ve-panel" aria-label="Media bin">
			<div className="ve-panel__header">
				<h2>Media bin</h2>
				<span>{resources.length}</span>
			</div>
			{!activeProject ? (
				<p className="ve-empty">No active project.</p>
			) : resources.length === 0 ? (
				<p className="ve-empty">Import a sample asset to populate the bin.</p>
			) : (
				<ul className="ve-resource-list">
					{resources.map((resource) => (
						<li key={resource.id}>
							<div>
								<strong>{String(resource.attrs.name)}</strong>
								<small>{getResourceLabel(resource)}</small>
							</div>
							<button
								type="button"
								onClick={() => actions.addResourceToTimeline(resource.id)}
							>
								Add to timeline
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	)
})
