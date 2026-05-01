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
	const projectEntity$ = projects$.entitiesById[rootEntityId]
	const resourceIds = projectEntity$.rels.resources.get()
	const resourceCount = Array.isArray(resourceIds) ? resourceIds.length : 0
	const timelineId = projectEntity$.rels.activeTimeline.get()
	const trackIds =
		typeof timelineId === 'string'
			? projects$.entitiesById[timelineId].rels.tracks.get()
			: []
	const clipCount = Array.isArray(trackIds)
		? trackIds.reduce((count, trackId) => {
				const clipIds = projects$.entitiesById[trackId].rels.clips.get()
				return count + (Array.isArray(clipIds) ? clipIds.length : 0)
			}, 0)
		: 0
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
