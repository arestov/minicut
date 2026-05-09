import { Download, FolderPlus } from 'lucide-react'
import { useRootAttrs } from '../../dkt-react-sync/hooks/useRootAttrs'
import { useVideoEditor } from '../app/VideoEditorContext'
import type { ExportProgressState } from '../app/exportProgressState'
import { formatExportProgress, isExportRunning } from '../app/exportProgressState'
import { IconButton } from './ControlPrimitives'
import { ProjectDropdown } from './ProjectDropdown'

const parseExportProgress = (value: unknown): ExportProgressState | null =>
	value && typeof value === 'object' && 'stage' in value ? value as ExportProgressState : null

export const Toolbar = () => {
	const { actions } = useVideoEditor()
	const rootAttrs = useRootAttrs(['activeProjectId', 'exportProgress']) as { activeProjectId?: unknown; exportProgress?: unknown }
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
	const exportProgress = parseExportProgress(rootAttrs.exportProgress)
	const projectExport = exportProgress?.range.type === 'project' ? exportProgress : null
	const projectDownloadUrl = projectExport?.stage === 'done' ? actions.getCachedExportUrl(projectExport.id) : null
	const isProjectExportRunning = isExportRunning(projectExport)

	const exportProject = (): void => {
		actions.requestProjectExport()
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
					icon={Download}
					label="Export project"
					variant="default"
					onClick={exportProject}
					disabled={!activeProjectId || isProjectExportRunning}
				>
					Export
				</IconButton>
				{projectExport && isProjectExportRunning ? <span className="ve-toolbar__status">Export {formatExportProgress(projectExport)}</span> : null}
				{projectExport?.stage === 'done' ? <span className="ve-toolbar__status" role="status">Export ready: {projectExport.fileName ?? 'file prepared'}</span> : null}
				{projectExport?.stage === 'done' && projectDownloadUrl
					? <a className="ve-toolbar__status ve-preview__link" href={projectDownloadUrl} download={projectExport.fileName ?? 'export.webm'}>Download file</a>
					: null}
				{projectExport?.stage === 'error' ? <span className="ve-toolbar__status is-error" role="status">Export failed{projectExport.error ? `: ${projectExport.error}` : ''}</span> : null}
			</div>
		</header>
	)
}
