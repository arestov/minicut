import { useState } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { One } from '../../dkt-react-sync/components/One'
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import { useMany } from '../../dkt-react-sync/hooks/useMany'
import { useVideoEditor } from '../app/VideoEditorContext'
import { Button, IconButton } from './ControlPrimitives'

interface ProjectItemProps {
	activeProjectId: string | null
	onSelect: () => void
}

interface ProjectAttrs {
	sourceProjectId?: unknown
	title?: unknown
	updatedAt?: unknown
}

const ProjectItem = ({ activeProjectId, onSelect }: ProjectItemProps) => {
	const { actions } = useVideoEditor()
	const projectAttrs = useAttrs(['sourceProjectId', 'title', 'updatedAt']) as ProjectAttrs
	const resources = useMany('resources')
	const projectId = typeof projectAttrs.sourceProjectId === 'string' ? projectAttrs.sourceProjectId : null
	const projectTitle = String(projectAttrs.title ?? 'Project')
	const projectVersion = Number(projectAttrs.updatedAt ?? 1) || 1
	const isActive = projectId === activeProjectId

	return (
		<li>
			<button
				type="button"
				className={isActive ? 'is-active' : ''}
				onClick={() => {
					if (projectId) {
						actions.setActiveProject(projectId)
					}
					onSelect()
				}}
				aria-pressed={isActive}
			>
				<span className="ve-project-list__title">
					{projectTitle}
					{isActive ? <Check size={14} aria-hidden="true" /> : null}
				</span>
				<small>v{projectVersion} - {resources.length} resources</small>
			</button>
		</li>
	)
}

const ProjectDropdownEmptyMenu = ({ onClose }: { onClose: () => void }) => {
	const { actions } = useVideoEditor()

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
			<p className="ve-empty ve-project-dropdown__empty">No projects yet.</p>
		</div>
	)
}

const ProjectDropdownMenu = ({ activeProjectId, onClose }: { activeProjectId: string | null; onClose: () => void }) => {
	const { actions } = useVideoEditor()
	const projectScopes = useMany('project')

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
			{projectScopes.length === 0 ? (
				<p className="ve-empty ve-project-dropdown__empty">No projects yet.</p>
			) : (
				<ul className="ve-project-list ve-project-dropdown__list">
					{projectScopes.map((projectScope) => (
						<ScopeContext.Provider key={projectScope._nodeId} value={projectScope}>
							<ProjectItem
								activeProjectId={activeProjectId}
								onSelect={onClose}
							/>
						</ScopeContext.Provider>
					))}
				</ul>
			)}
		</div>
	)
}

const ActiveProjectTitle = () => {
	const attrs = useAttrs(['title']) as { title?: unknown }

	return <span>{String(attrs.title ?? 'No project')}</span>
}

const FirstProjectTitleFromPioneer = () => {
	const projectScopes = useMany('project')
	const firstProjectScope = projectScopes[0] ?? null

	if (!firstProjectScope) {
		return <span>No project</span>
	}

	return (
		<ScopeContext.Provider value={firstProjectScope}>
			<ActiveProjectTitle />
		</ScopeContext.Provider>
	)
}

export const ProjectDropdown = () => {
	const [isOpen, setIsOpen] = useState(false)
	const rootAttrs = useAttrs(['activeProjectId']) as { activeProjectId?: unknown }
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
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
				<One rel="activeProject" fallback={<One rel="pioneer" fallback={<span>No project</span>}><FirstProjectTitleFromPioneer /></One>}>
					<ActiveProjectTitle />
				</One>
				<ChevronDown className="ve-project-dropdown__chevron" size={14} aria-hidden="true" />
			</Button>
			{isOpen ? (
				<One rel="pioneer" fallback={<ProjectDropdownEmptyMenu onClose={close} />}>
					<ProjectDropdownMenu activeProjectId={activeProjectId} onClose={close} />
				</One>
			) : null}
		</div>
	)
}
