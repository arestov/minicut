import { useContext } from 'react'
import { Download } from 'lucide-react'
import { ScopeContext } from '../../../dkt-react-sync/context/ScopeContext'
import { useAttrs } from '../../../dkt-react-sync/hooks/useAttrs'
import { useRootAttrs } from '../../../dkt-react-sync/hooks/useRootAttrs'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { formatExportProgress, isExportRunning, type ExportProgressState } from '../../app/exportProgressState'
import { IconButton } from '../ControlPrimitives'
import { InspectorSection } from './InspectorSection'

const parseExportProgress = (value: unknown): ExportProgressState | null =>
	value && typeof value === 'object' && 'stage' in value ? value as ExportProgressState : null

export const InspectorExportTabPanel = () => {
	const { actions } = useVideoEditor()
	const scope = useContext(ScopeContext)
	const { name } = useAttrs(['name']) as { name?: unknown }
	const rootAttrs = useRootAttrs(['exportProgress']) as { exportProgress?: unknown }
	const clipId = typeof scope?._nodeId === 'string' ? scope._nodeId : null
	const exportProgress = parseExportProgress(rootAttrs.exportProgress)
	const clipExport = clipId && exportProgress?.range.type === 'clip' && exportProgress.range.clipId === clipId
		? exportProgress
		: null
	const downloadUrl = clipExport?.stage === 'done' ? actions.getCachedExportUrl(clipExport.id) : null
	const isClipExportRunning = isExportRunning(clipExport)
	const clipExportLabel = clipExport ? formatExportProgress(clipExport) : 'queued 0%'

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Export inspector">
			<InspectorSection title="Clip export" icon={Download}>
				<dl className="ve-inspector-grid"><div><dt>Range</dt><dd>Clip</dd></div><div><dt>Format</dt><dd>WebM</dd></div><div><dt>Quality</dt><dd>High</dd></div></dl>
				<IconButton
					type="button"
					icon={Download}
					label="Queue clip export"
					variant="default"
					disabled={isClipExportRunning || !clipId}
					onClick={() => {
						if (clipId) {
							actions.requestSelectedClipExport()
						}
					}}
				>
					{isClipExportRunning ? `Rendering ${clipExportLabel}` : 'Queue clip export'}
				</IconButton>
				{isClipExportRunning ? <p className="ve-preview__summary" aria-live="polite">Rendering export file for {String(name)}: {clipExportLabel}</p> : null}
				{clipExport?.stage === 'done' ? <p className="ve-preview__summary" role="status">Export ready: {clipExport.frameCount ?? 0} frames · {clipExport.size ?? 0} bytes{clipExport.fileName ? ` · ${clipExport.fileName}` : ''}</p> : null}
				{clipExport?.stage === 'done' && downloadUrl
					? <a className="ve-preview__summary ve-preview__link" href={downloadUrl} download={clipExport.fileName ?? 'export.webm'}>Download file</a>
					: null}
				{clipExport?.stage === 'error' ? <p className="ve-preview__summary" role="status">Export failed: {clipExport.error ?? 'Unknown error'}</p> : null}
				{!clipId ? <p className="ve-preview__summary" role="status">Select a clip before exporting.</p> : null}
			</InspectorSection>
		</div>
	)
}
