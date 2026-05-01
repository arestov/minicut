import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ResourceAttrs } from '../domain/types'

interface ResourceRowProps {
	projectId: string
	resourceId: string
}

const ResourceRow = observer(({ projectId, resourceId }: ResourceRowProps) => {
	const { projects$, actions } = useVideoEditor()
	const resource$ = projects$.entitiesById[resourceId]
	const attrs = resource$.attrs.get() as unknown as ResourceAttrs

	return (
		<li>
			<div>
				<strong>{attrs.name}</strong>
				<small>
					{attrs.name} · {attrs.kind} · {attrs.mime} · {attrs.duration.toFixed(1)}s
				</small>
			</div>
			<button type="button" onClick={() => actions.addResourceToTimeline(resourceId)}>
				Add to timeline
			</button>
		</li>
	)
})

export const MediaBin = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const resourceIds = rootEntityId
		? projects$.entitiesById[rootEntityId].rels.resources.get()
		: []
	const resources = Array.isArray(resourceIds) ? resourceIds : []

	return (
		<section className="ve-panel" aria-label="Media bin">
			<div className="ve-panel__header">
				<h2>Media bin</h2>
				<label className="ve-import-button">
					<span>Import</span>
					<input
						type="file"
						aria-label="Import media files"
						accept="video/*,image/*,audio/*"
						multiple
						disabled={!activeProjectId}
						onChange={(event) => {
							if (event.currentTarget.files) {
								actions.importFiles(event.currentTarget.files)
								event.currentTarget.value = ''
							}
						}}
					/>
				</label>
			</div>
			<div className="ve-media-count">{resources.length} assets</div>
			{!activeProjectId ? (
				<p className="ve-empty">No active project.</p>
			) : resources.length === 0 ? (
				<p className="ve-empty">Import video, image, or audio files to populate the bin.</p>
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
