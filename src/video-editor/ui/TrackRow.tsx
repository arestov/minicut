import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { getActiveProject, getClipEntitiesForTrack } from '../domain/selectors'
import type { Entity } from '../domain/types'
import { ClipItem } from './ClipItem'

interface TrackRowProps {
	track: Entity
}

export const TrackRow = observer(({ track }: TrackRowProps) => {
	const { projects$, session$ } = useVideoEditor()
	const activeProject = getActiveProject(projects$.get(), session$.get())
	const clipEntities = activeProject ? getClipEntitiesForTrack(activeProject, track.id) : []
	const selectedEntityId = session$.selectedEntityId.get()

	return (
		<div className="ve-track-row">
			<div className="ve-track-row__label">
				<strong>{String(track.attrs.name)}</strong>
				<small>{String(track.attrs.kind)}</small>
			</div>
			<div className="ve-track-row__clips">
				{clipEntities.length === 0 ? (
					<p className="ve-empty">Drop clips here.</p>
				) : (
					clipEntities.map((clip) => (
						<ClipItem key={clip.id} clip={clip} selected={clip.id === selectedEntityId} />
					))
				)}
			</div>
		</div>
	)
})
