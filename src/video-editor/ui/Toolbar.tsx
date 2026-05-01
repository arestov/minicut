import { observer } from '@legendapp/state/react'
import { Download, FolderPlus, Redo2, Undo2, Upload } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { IconButton } from './ControlPrimitives'
import { ProjectDropdown } from './ProjectDropdown'

export const Toolbar = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()

	return (
		<header className="ve-toolbar">
			<div className="ve-toolbar__left">
				<div className="ve-toolbar__mark" aria-hidden="true">M</div>
				<div className="ve-toolbar__brand">
					<h1>minicut</h1>
					<p>Video workspace</p>
				</div>
				<ProjectDropdown />
				<IconButton
					type="button"
					icon={FolderPlus}
					label="New project"
					variant="ghost"
					onClick={() => actions.createProject()}
				>
					New
				</IconButton>
			</div>
			<div className="ve-toolbar__actions">
				<div className="ve-toolbar__history" aria-label="History controls">
					<IconButton type="button" icon={Undo2} label="Undo" variant="ghost" disabled />
					<IconButton type="button" icon={Redo2} label="Redo" variant="ghost" disabled />
				</div>
				<IconButton
					type="button"
					icon={Upload}
					label="Import sample"
					variant="outline"
					onClick={() => actions.importSampleResource()}
					disabled={!activeProjectId}
				>
					Import sample
				</IconButton>
				<IconButton type="button" icon={Download} label="Export project" variant="default" disabled>
					Export
				</IconButton>
			</div>
		</header>
	)
})
