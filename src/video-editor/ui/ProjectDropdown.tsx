import { useState } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import {
	EditorScopeProvider,
	ROOT_SCOPE,
	useEditorActions,
	useEditorAttrs,
	useEditorComp,
	useEditorMany,
	useEditorOne,
} from '../render-sync'
import type { EditorScope } from '../render-sync/EditorScope'
import { Button, IconButton } from './ControlPrimitives'

interface ProjectItemProps {
	activeProjectId: string | null
	onSelect: () => void
	projectScope: EditorScope
}

interface ProjectAttrs {
	title?: unknown
}

const ProjectItem = ({ projectScope, activeProjectId, onSelect }: ProjectItemProps) => {
	const dispatch = useEditorActions(ROOT_SCOPE)
	const projectAttrs = useEditorAttrs<ProjectAttrs>(['title'], projectScope)
	const projectId = useEditorComp<string | null>('projectId', projectScope)
	const projectVersion = useEditorComp<number>('projectVersion', projectScope)
	const resourceCount = useEditorComp<number>('resourceCount', projectScope)
	const projectTitle = String(projectAttrs.title ?? 'Project')
	const isActive = projectId === activeProjectId

	return (
		<li>
			<button
				type="button"
				className={isActive ? 'is-active' : ''}
				onClick={() => {
					if (projectId) {
						dispatch('setActiveProject', { projectId })
					}
					onSelect()
				}}
				aria-pressed={isActive}
			>
				<span className="ve-project-list__title">
					{projectTitle}
					{isActive ? <Check size={14} aria-hidden="true" /> : null}
				</span>
				<small>v{projectVersion} - {resourceCount} resources</small>
			</button>
		</li>
	)
}

const ProjectDropdownMenu = ({ onClose }: { onClose: () => void }) => {
	const dispatch = useEditorActions(ROOT_SCOPE)
	const projectScopes = useEditorMany('projects', ROOT_SCOPE)
	const rootAttrs = useEditorAttrs<{ activeProjectId?: unknown }>(['activeProjectId'], ROOT_SCOPE)
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null

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
						dispatch('createProject')
						onClose()
					}}
				>
					New project
				</IconButton>
			</div>
			{projectScopes.length === 0 ? (
				<p className="ve-empty ve-project-dropdown__empty">No projects yet.</p>
			) : (
				<ul className="ve-project-list ve-project-dropdown__list">
					{projectScopes.map((projectScope) => (
						<EditorScopeProvider key={projectScope.nodeId} scope={projectScope}>
							<ProjectItem
								projectScope={projectScope}
								activeProjectId={activeProjectId}
								onSelect={onClose}
							/>
						</EditorScopeProvider>
					))}
				</ul>
			)}
		</div>
	)
}

const ActiveProjectTitle = ({ projectScope }: { projectScope: EditorScope }) => {
	const projectAttrs = useEditorAttrs<ProjectAttrs>(['title'], projectScope)

	return <span>{String(projectAttrs.title ?? 'No project')}</span>
}

export const ProjectDropdown = () => {
	const [isOpen, setIsOpen] = useState(false)
	const activeProjectScope = useEditorOne('activeProject', ROOT_SCOPE)
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
				{activeProjectScope ? (
					<EditorScopeProvider scope={activeProjectScope}>
						<ActiveProjectTitle projectScope={activeProjectScope} />
					</EditorScopeProvider>
				) : (
					<span>No project</span>
				)}
				<ChevronDown className="ve-project-dropdown__chevron" size={14} aria-hidden="true" />
			</Button>
			{isOpen ? <ProjectDropdownMenu onClose={close} /> : null}
		</div>
	)
}
