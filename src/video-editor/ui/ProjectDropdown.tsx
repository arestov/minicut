import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	getActiveProjectId$,
	getProjectResourceIds$,
	getProjectRootEntityId$,
	projectEntityAttrs$,
} from '../legend/observableSelectors'
import { Button, IconButton } from './ControlPrimitives'

interface ProjectItemProps {
	projectId: string
	activeProjectId: string | null
	onSelect: () => void
}

const ProjectItem = observer(({ projectId, activeProjectId, onSelect }: ProjectItemProps) => {
 	const { projects$, actions } = useVideoEditor()
	const project$ = projects$.projects[projectId]
	const rootEntityId = getProjectRootEntityId$(projects$, projectId)
	const projectTitle = rootEntityId ? String(projectEntityAttrs$(projects$, rootEntityId).title.get()) : 'Project'
	const resourceCount = getProjectResourceIds$(projects$, projectId).length
	const isActive = projectId === activeProjectId

	return (
		<li>
			<button
				type="button"
				className={isActive ? 'is-active' : ''}
				onClick={() => {
					actions.setActiveProject(projectId)
					onSelect()
				}}
				aria-pressed={isActive}
			>
				<span className="ve-project-list__title">
					{projectTitle}
					{isActive ? <Check size={14} aria-hidden="true" /> : null}
				</span>
				<small>v{project$.version.get()} - {resourceCount} resources</small>
			</button>
		</li>
	)
})

const ProjectDropdownMenu = observer(({ onClose }: { onClose: () => void }) => {
	const { projects$, session$, actions } = useVideoEditor()
	const projectIds = Object.keys(projects$.projects.get())
	const activeProjectId = getActiveProjectId$(projects$, session$)

	return (
		<div className="ve-project-dropdown__menu is-open">
			<div className="ve-project-dropdown__header">
				<span>Projects</span>
				<IconButton
					type="button"
					className="ve-project-dropdown__new"
					variant="default"
					icon={Plus}
					label="New project"
					onClick={() => {
						actions.createProject()
						onClose()
					}}
				>
					New project
				</IconButton>
			</div>
			{projectIds.length === 0 ? (
				<p className="ve-empty ve-project-dropdown__empty">No projects yet.</p>
			) : (
				<ul className="ve-project-list ve-project-dropdown__list">
					{projectIds.map((id) => (
						<ProjectItem
							key={id}
							projectId={id}
							activeProjectId={activeProjectId}
							onSelect={onClose}
						/>
					))}
				</ul>
			)}
		</div>
	)
})

export const ProjectDropdown = observer(() => {
	const [isOpen, setIsOpen] = useState(false)
	const { projects$, session$ } = useVideoEditor()
	const activeProjectId = getActiveProjectId$(projects$, session$)
	const activeRootId = getProjectRootEntityId$(projects$, activeProjectId)
	const activeTitle = activeRootId
		? String(projectEntityAttrs$(projects$, activeRootId).title.get())
		: 'No project'

	const close = () => setIsOpen(false)

	return (
		<div aria-label="Projects" className="ve-project-dropdown">
			<Button
				type="button"
				className="ve-project-dropdown__trigger"
				variant="secondary"
				size="sm"
				aria-expanded={isOpen}
				aria-haspopup="menu"
				onClick={() => setIsOpen((v) => !v)}
			>
				<span>{activeTitle}</span>
				<ChevronDown className="ve-project-dropdown__chevron" size={14} aria-hidden="true" />
			</Button>
			{isOpen ? <ProjectDropdownMenu onClose={close} /> : null}
		</div>
	)
})
