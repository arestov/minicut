import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ResourceAttrs } from '../domain/types'

interface ResourceRowProps {
	projectId: string
	resourceId: string
}

const ResourceRow = observer(({ projectId, resourceId }: ResourceRowProps) => {
	const { projects$, actions } = useVideoEditor()
	const resource$ = projects$.projects[projectId].entities[resourceId]
	const attrs = resource$.attrs.get() as unknown as ResourceAttrs

	return (
		<li>
			<div>
				<strong>{attrs.name}</strong>
				<small>
					{attrs.name} · {attrs.kind} · {attrs.duration.toFixed(1)}s
				</small>
			</div>
			<button type="button" onClick={() => actions.addResourceToTimeline(resourceId)}>
				Add to timeline
			</button>
		</li>
	)
})

export const MediaBin = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const resourceIds = rootEntityId
		? activeProject$?.entities[rootEntityId].rels.resources.get()
		: []
	const resources = Array.isArray(resourceIds) ? resourceIds : []

	return (
		<section className="ve-panel" aria-label="Media bin">
			<div className="ve-panel__header">
				<h2>Media bin</h2>
				<span>{resources.length}</span>
			</div>
			{!activeProjectId ? (
				<p className="ve-empty">No active project.</p>
			) : resources.length === 0 ? (
				<p className="ve-empty">Import a sample asset to populate the bin.</p>
			) : (
				<ul className="ve-resource-list">
					{resources.map((resourceId) => (
						<ResourceRow key={resourceId} projectId={activeProjectId} resourceId={resourceId} />
					))}
				</ul>
			)}
		</section>
	)
})
