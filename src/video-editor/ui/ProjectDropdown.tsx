import { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'

interface ProjectItemProps {
projectId: string
activeProjectId: string | null
onSelect: () => void
}

const ProjectItem = observer(({ projectId, activeProjectId, onSelect }: ProjectItemProps) => {
const { projects$, actions } = useVideoEditor()
const project$ = projects$.projects[projectId]
const rootEntityId = project$.rootEntityId.get()
const projectEntity$ = projects$.entitiesById[rootEntityId]
const resourceIds = projectEntity$.rels.resources.get()
const resourceCount = Array.isArray(resourceIds) ? resourceIds.length : 0
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
<span>{String(projectEntity$.attrs.title.get())}</span>
<small>v{project$.version.get()} - {resourceCount} resources</small>
</button>
</li>
)
})

export const ProjectDropdown = observer(() => {
const [isOpen, setIsOpen] = useState(false)
const { projects$, session$ } = useVideoEditor()
const projectIds = Object.keys(projects$.projects.get())
const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
const activeRootId = activeProject$?.rootEntityId.get()
const activeTitle = activeRootId
? String(projects$.entitiesById[activeRootId].attrs.title.get())
: 'No project'

const close = () => setIsOpen(false)

return (
<div aria-label="Projects" className="ve-project-dropdown">
<button
type="button"
className="ve-project-dropdown__trigger"
aria-expanded={isOpen}
aria-haspopup="listbox"
onClick={() => setIsOpen((v) => !v)}
>
<span>{activeTitle}</span>
<svg
className="ve-project-dropdown__chevron"
width="12"
height="12"
viewBox="0 0 12 12"
fill="none"
aria-hidden="true"
>
<path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
</svg>
</button>
{isOpen && (
<div className="ve-project-dropdown__menu">
{projectIds.length === 0 ? (
<p className="ve-empty ve-project-dropdown__empty">No projects yet.</p>
) : (
<ul className="ve-project-list ve-project-dropdown__list">
{projectIds.map((id) => (
<ProjectItem
key={id}
projectId={id}
activeProjectId={activeProjectId}
onSelect={close}
/>
))}
</ul>
)}
</div>
)}
</div>
)
})
