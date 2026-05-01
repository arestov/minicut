import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getActiveProject, getResourceEntities, getSelectedClip } from '../domain/selectors'

export const Toolbar = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const registry = projects$.get()
	const session = session$.get()
	const activeProject = getActiveProject(registry, session)
	const selectedClip = getSelectedClip(registry, session)
	const resources = activeProject ? getResourceEntities(activeProject) : []

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
				<button type="button" onClick={() => actions.importSampleResource()} disabled={!activeProject}>
					Import sample
				</button>
				<button
					type="button"
					onClick={() => resources[0] && actions.addResourceToTimeline(resources[0].id)}
					disabled={!resources[0]}
				>
					Add first resource
				</button>
				<button type="button" onClick={() => actions.splitSelectedClip()} disabled={!selectedClip}>
					Split selected clip
				</button>
				<button type="button" onClick={() => actions.nudgeSelectedClip(0.5)} disabled={!selectedClip}>
					Nudge +0.5s
				</button>
			</div>
		</header>
	)
})
