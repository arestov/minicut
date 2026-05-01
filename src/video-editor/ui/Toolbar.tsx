import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'

export const Toolbar = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const selectedEntityId = session$.selectedEntityId.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const resourceIds = rootEntityId
		? activeProject$?.entities[rootEntityId].rels.resources.get()
		: []
	const resources = Array.isArray(resourceIds) ? resourceIds : []
	const selectedEntityType = selectedEntityId
		? activeProject$?.entities[selectedEntityId].type.get()
		: null
	const hasSelectedClip = selectedEntityType === 'clip'

	return (
		<header className="ve-toolbar">
			<div>
				<h1>Video Editor Harness</h1>
				<p>Legend-State projection + single-writer memory worker + Testing Library harness.</p>
			</div>
			<div className="ve-toolbar__actions">
				<button type="button" onClick={() => actions.createProject()}>
					New project
				</button>
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
				<button type="button" onClick={() => actions.splitSelectedClip()} disabled={!hasSelectedClip}>
					Split selected clip
				</button>
				<button type="button" onClick={() => actions.nudgeSelectedClip(0.5)} disabled={!hasSelectedClip}>
					Nudge +0.5s
				</button>
			</div>
		</header>
	)
})
