import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { ClipItem } from './ClipItem'

interface TrackRowProps {
	projectId: string
	trackId: string
	timelineZoom: number
}

export const TrackRow = observer(({ projectId, trackId, timelineZoom }: TrackRowProps) => {
	const { projects$, session$ } = useVideoEditor()
	const track$ = projects$.projects[projectId].entities[trackId]
	const clipIds = track$.rels.clips.get()
	const clips = Array.isArray(clipIds) ? clipIds : []
	const selectedEntityId = session$.selectedEntityId.get()

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
					clips.map((clipId) => (
						<ClipItem
							key={clipId}
							projectId={projectId}
							clipId={clipId}
							selected={clipId === selectedEntityId}
							timelineZoom={timelineZoom}
						/>
					))
				)}
			</div>
		</div>
	)
})
