import { ScopeContext } from '../../../dkt-react-sync/context/ScopeContext'
import { useActions } from '../../../dkt-react-sync/hooks/useActions'
import { useAttrs } from '../../../dkt-react-sync/hooks/useAttrs'
import { useOne } from '../../../dkt-react-sync/hooks/useOne'
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

const ResourcePreview = ({ color, name }: { color: string; name: string }) => {
	const resourceAttrs = useAttrs(['kind', 'url', 'name']) as ResourceRenderAttrs

	return <ClipHeaderPreview resource={resourceAttrs} color={color} name={name} />
}

export const InspectorClipHeader = ({ trackPosition }: { trackPosition: { trackName: string; ordinal: number } | null }) => {
	const dispatch = useActions()
	const attrs = useAttrs(['sourceClipId', 'name', 'color', 'start', 'duration']) as ClipRenderAttrs & { sourceClipId?: unknown }
	const resourceScope = useOne('resource')
	const name = String(attrs.name)
	const color = String(attrs.color ?? '#2563eb')
	const start = Number(attrs.start)
	const duration = Number(attrs.duration)
	const trackName = trackPosition?.trackName ?? 'Track'
	const ordinal = trackPosition?.ordinal ?? 1

	return (
		<div className="ve-inspector-selected">
			{resourceScope ? (
				<ScopeContext.Provider value={resourceScope}>
					<ResourcePreview color={color} name={name} />
				</ScopeContext.Provider>
			) : (
				<ClipHeaderPreview resource={null} color={color} name={name} />
			)}
			<div>
				<input
					className="ve-inspector-name ve-inspector-title-input"
					type="text"
					aria-label="Clip name"
					value={name}
					onChange={(event) => {
						dispatch('rename', { name: event.currentTarget.value })
					}}
				/>
				<small>Clip {ordinal} - {trackName} - {formatSeconds(start)} - Duration {formatSeconds(duration)}</small>
			</div>
		</div>
	)
}
