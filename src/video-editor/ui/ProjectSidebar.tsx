import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'

interface ProjectListItemProps {
	projectId: string
	activeProjectId: string | null
}

const ProjectListItem = observer(({ projectId, activeProjectId }: ProjectListItemProps) => {
	const { projects$, actions } = useVideoEditor()
	const project$ = projects$.projects[projectId]
	const rootEntityId = project$.rootEntityId.get()
	const projectEntity$ = project$.entities[rootEntityId]
	const resourceIds = projectEntity$.rels.resources.get()
	const resourceCount = Array.isArray(resourceIds) ? resourceIds.length : 0
	const clipCount = Object.values(project$.entities.get()).filter(
		(entity) => entity.type === 'clip',
	).length
	const isActive = projectId === activeProjectId

	return (
		<li>
			<button
				type="button"
				className={isActive ? 'is-active' : ''}
				onClick={() => actions.setActiveProject(projectId)}
				aria-pressed={isActive}
			>
				<span>{String(projectEntity$.attrs.title.get())}</span>
				<small>
					v{project$.version.get()} · {resourceCount} resources · {clipCount} clips
				</small>
			</button>
		</li>
	)
})

export const ProjectSidebar = observer(() => {
	const { projects$, session$ } = useVideoEditor()
	const projectIds = Object.keys(projects$.projects.get())
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()

	return (
		<aside className="ve-panel ve-sidebar" aria-label="Projects">
			<div className="ve-panel__header">
				<h2>Projects</h2>
				<span>{projectIds.length}</span>
			</div>
			{projectIds.length === 0 ? (
				<p className="ve-empty">Create a project to start the happy path.</p>
			) : (
				<ul className="ve-project-list">
					{projectIds.map((projectId) => (
						<ProjectListItem
							key={projectId}
							projectId={projectId}
							activeProjectId={activeProjectId}
						/>
					))}
				</ul>
			)}
		</aside>
	)
})
