import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { ProjectDropdown } from './ProjectDropdown'

export const Toolbar = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const resourceIds = rootEntityId
		? projects$.entitiesById[rootEntityId].rels.resources.get()
		: []
	const resources = Array.isArray(resourceIds) ? resourceIds : []

	return (
		<header className="ve-toolbar">
			<div className="ve-toolbar__left">
				<div className="ve-toolbar__mark" aria-hidden="true">M</div>
				<div className="ve-toolbar__brand">
					<h1>minicut</h1>
					<p>Workspace</p>
				</div>
				<ProjectDropdown />
			</div>
			<div className="ve-toolbar__actions">
				<button type="button" onClick={() => actions.importSampleResource()} disabled={!activeProjectId}>
					Import sample
				</button>
				<button
					type="button"
					onClick={() => resources[0] && actions.addResourceToTimeline(resources[0])}
					disabled={!resources[0]}
				>
					Add first resource
				</button>
			</div>
		</header>
	)
})
