import { observer } from '@legendapp/state/react'
import { useState } from 'react'
import { Download, FolderPlus, Redo2, Type, Undo2 } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ExportProgressEvent } from '../render/exportRenderer'
import { IconButton } from './ControlPrimitives'
import { ProjectDropdown } from './ProjectDropdown'

const exportStageLabel: Record<ExportProgressEvent['stage'], string> = {
	queued: 'queued',
	rendering: 'rendering',
	finalizing: 'finalizing',
	done: 'done',
}

const formatExportProgress = (event: ExportProgressEvent): string => {
	const progressPercent = Math.round(Math.max(0, Math.min(1, event.progress)) * 100)
	return `Export ${exportStageLabel[event.stage]} ${progressPercent}%`
}

export const Toolbar = observer(() => {
	const { projects$, session$, history$, actions } = useVideoEditor()
	const [exportStatus, setExportStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
	const [exportProgress, setExportProgress] = useState<ExportProgressEvent>({ stage: 'queued', progress: 0 })
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const canUndo = history$.canUndo.get()
	const canRedo = history$.canRedo.get()

	const exportProject = (): void => {
		setExportStatus('rendering')
		setExportProgress({ stage: 'queued', progress: 0 })
		actions.queueProjectExport((event) => {
			setExportProgress(event)
		})
			.then((result) => {
				if (!result) {
					setExportStatus('error')
					return
				}

				if (result.downloadUrl) {
					const link = document.createElement('a')
					link.href = result.downloadUrl
					link.download = result.fileName
					link.style.display = 'none'
					document.body.append(link)
					link.click()
					link.remove()
				}

				setExportStatus('ready')
			})
			.catch(() => setExportStatus('error'))
	}

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
				<IconButton
					type="button"
					icon={Type}
					label="Add text"
					variant="secondary"
					onClick={() => actions.addTextClip()}
					disabled={!activeProjectId}
				>
					Text
				</IconButton>
				<div className="ve-toolbar__history" aria-label="History controls">
					<IconButton type="button" icon={Undo2} label="Undo" variant="ghost" onClick={() => actions.undo()} disabled={!canUndo} />
					<IconButton type="button" icon={Redo2} label="Redo" variant="ghost" onClick={() => actions.redo()} disabled={!canRedo} />
				</div>
				<IconButton
					type="button"
					icon={Download}
					label="Export project"
					variant="default"
					onClick={exportProject}
					disabled={!activeProjectId || exportStatus === 'rendering'}
				>
					Export
				</IconButton>
				{exportStatus === 'rendering' ? <span className="ve-toolbar__status">{formatExportProgress(exportProgress)}</span> : null}
				{exportStatus === 'ready' ? <span className="ve-toolbar__status" role="status">Export ready</span> : null}
				{exportStatus === 'error' ? <span className="ve-toolbar__status is-error" role="status">Export failed</span> : null}
			</div>
		</header>
	)
})
