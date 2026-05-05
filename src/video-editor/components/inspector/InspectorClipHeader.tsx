import { ROOT_SCOPE, useEditorActions, useEditorAttrs, useEditorComp, useEditorOne, type ClipTrackPositionSummary } from '../../render-sync'
import type { EditorScope } from '../../render-sync/EditorScope'
import { formatSeconds } from '../format'
import type { ClipRenderAttrs, ResourceRenderAttrs } from './types'

const isPreviewableResourceUrl = (url: string): boolean =>
	url.startsWith('blob:')
	|| url.startsWith('/')
	|| url.startsWith('./')
	|| url.startsWith('http')
	|| url.startsWith('data:')

const ClipHeaderPreview = ({ resource, color, name }: {
	resource: ResourceRenderAttrs | null
	color: string
	name: string
}) => {
	const url = String(resource?.url ?? '')
	const kind = String(resource?.kind ?? '')
	const canPreview = isPreviewableResourceUrl(url)

	return (
		<div className="ve-inspector-thumb" style={{ borderColor: color }} aria-label="Clip preview">
			{canPreview && kind === 'image' ? <img src={url} alt="" /> : null}
			{canPreview && kind === 'video' ? <video src={url} muted preload="metadata" aria-label={`${name} first frame`} /> : null}
			{!canPreview || (kind !== 'image' && kind !== 'video') ? <span>{kind === 'audio' ? 'AUD' : 'CLIP'}</span> : null}
		</div>
	)
}

export const InspectorClipHeader = ({ clipScope }: { clipScope: EditorScope }) => {
	const dispatch = useEditorActions(clipScope)
	const attrs = useEditorAttrs<ClipRenderAttrs>(['name', 'color', 'start', 'duration'], clipScope)
	const resourceScope = useEditorOne('resource', clipScope)
	const resourceAttrs = useEditorAttrs<ResourceRenderAttrs>(['kind', 'url', 'name'], resourceScope ?? ROOT_SCOPE)
	const trackPosition = useEditorComp<ClipTrackPositionSummary | null>('trackPosition', clipScope)
	const name = String(attrs.name)
	const color = String(attrs.color ?? '#2563eb')
	const start = Number(attrs.start)
	const duration = Number(attrs.duration)
	const selectedTrackName = trackPosition?.trackName ?? 'Track'
	const selectedClipOrdinal = trackPosition?.ordinal ?? 1

	return (
		<div className="ve-inspector-selected">
			<ClipHeaderPreview resource={resourceAttrs} color={color} name={name} />
			<div>
				<input
					className="ve-inspector-name ve-inspector-title-input"
					type="text"
					aria-label="Clip name"
					value={name}
					onChange={(event) => dispatch('rename', { name: event.currentTarget.value })}
				/>
				<small>Clip {selectedClipOrdinal} - {selectedTrackName} - {formatSeconds(start)} - Duration {formatSeconds(duration)}</small>
			</div>
		</div>
	)
}
