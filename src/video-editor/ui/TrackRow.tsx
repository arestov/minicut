import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { ClipItem } from './ClipItem'

interface TrackRowProps {
	projectId: string
	trackId: string
	timelineZoom: number
}

interface ClipListItemProps {
	item$: Observable<string>
	projectId: string
	timelineZoom: number
}

const ClipListItem = observer(({ item$, projectId, timelineZoom }: ClipListItemProps) => {
	const { session$ } = useVideoEditor()
	const clipId = item$.get()
	const selectedEntityId = session$.selectedEntityId.get()

	return (
		<ClipItem
			projectId={projectId}
			clipId={clipId}
			selected={clipId === selectedEntityId}
			timelineZoom={timelineZoom}
		/>
	)
})

export const TrackRow = observer(({ projectId, trackId, timelineZoom }: TrackRowProps) => {
	const { projects$ } = useVideoEditor()
	const track$ = projects$.projects[projectId].entities[trackId]
	const clipIds$ = track$.rels.clips as Observable<string[]>
	const clipIds = clipIds$.get()
	const clips = Array.isArray(clipIds) ? clipIds : []

	return (
		<div className="ve-track-row">
			<div className="ve-track-row__label">
				<strong>{String(track$.attrs.name.get())}</strong>
				<small>{String(track$.attrs.kind.get())}</small>
			</div>
			<div className="ve-track-row__rail">
				{clips.length === 0 ? (
					<p className="ve-empty">Drop clips here.</p>
				) : (
					<For
						each={clipIds$}
						optimized
						item={ClipListItem}
						itemProps={{ projectId, timelineZoom }}
					/>
				)}
			</div>
		</div>
	)
})
