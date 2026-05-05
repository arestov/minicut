import { Download } from 'lucide-react'
import { useState } from 'react'
import { useAttrs } from '../../../dkt-react-sync/hooks/useAttrs'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { IconButton } from '../ControlPrimitives'
import { InspectorSection } from './InspectorSection'
import { formatExportProgress, type ExportStatus } from './types'

export const InspectorExportTabPanel = () => {
	const [exportStatus, setExportStatus] = useState<ExportStatus>({ state: 'idle' })
	const { actions } = useVideoEditor()
	const { sourceClipId, name } = useAttrs(['sourceClipId', 'name']) as { sourceClipId?: unknown; name?: unknown }
	const clipId = typeof sourceClipId === 'string' ? sourceClipId : null

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Export inspector">
			<InspectorSection title="Clip export" icon={Download}>
				<dl className="ve-inspector-grid"><div><dt>Range</dt><dd>Clip</dd></div><div><dt>Format</dt><dd>MP4</dd></div><div><dt>Quality</dt><dd>High</dd></div></dl>
				<IconButton
					type="button"
					icon={Download}
					label="Queue clip export"
					variant="default"
					disabled={exportStatus.state === 'rendering' || !clipId}
					onClick={() => {
						if (!clipId) {
							setExportStatus({ state: 'error', message: 'Select a clip before exporting.' })
							return
						}
						setExportStatus({ state: 'rendering', progress: { stage: 'queued', progress: 0 } })
						actions.queueClipExportById(clipId, (progress) => {
							setExportStatus((current) => current.state === 'rendering' ? { state: 'rendering', progress } : current)
						}).then((result) => {
							setExportStatus(result ? { state: 'ready', result } : { state: 'error', message: 'Select a clip before exporting.' })
						}).catch((error: unknown) => {
							setExportStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
						})
					}}
				>
					{exportStatus.state === 'rendering' ? `Rendering ${formatExportProgress(exportStatus.progress)}` : 'Queue clip export'}
				</IconButton>
				{exportStatus.state === 'rendering' ? <p className="ve-preview__summary" aria-live="polite">Rendering export file for {String(name)}: {formatExportProgress(exportStatus.progress)}</p> : null}
				{exportStatus.state === 'ready' ? <p className="ve-preview__summary" role="status">Export ready: {exportStatus.result.frameCount} frames · {exportStatus.result.size} bytes{exportStatus.result.downloadUrl ? <> · <a href={exportStatus.result.downloadUrl} download={exportStatus.result.fileName}>Download file</a></> : null}</p> : null}
				{exportStatus.state === 'error' ? <p className="ve-preview__summary" role="status">Export failed: {exportStatus.message}</p> : null}
			</InspectorSection>
		</div>
	)
}
