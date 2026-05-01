import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getProjectMetaList } from '../domain/selectors'

export const ProjectSidebar = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const projectMetaList = getProjectMetaList(projects$.get())
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()

	return (
		<aside className="ve-panel ve-sidebar" aria-label="Projects">
			<div className="ve-panel__header">
				<h2>Projects</h2>
				<span>{projectMetaList.length}</span>
			</div>
			{projectMetaList.length === 0 ? (
				<p className="ve-empty">Create a project to start the happy path.</p>
			) : (
				<ul className="ve-project-list">
					{projectMetaList.map((project) => (
						<li key={project.id}>
							<button
								type="button"
								className={project.id === activeProjectId ? 'is-active' : ''}
								onClick={() => actions.setActiveProject(project.id)}
								aria-pressed={project.id === activeProjectId}
							>
								<span>{project.title}</span>
								<small>
									v{project.version} · {project.resourceCount} resources · {project.clipCount} clips
								</small>
							</button>
						</li>
					))}
				</ul>
			)}
		</aside>
	)
})
