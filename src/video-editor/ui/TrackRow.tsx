import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import { Eye, Lock, Volume2 } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { IconButton } from './ControlPrimitives'
import { ClipItem } from './ClipItem'

interface TrackRowProps {
	projectId: string
	trackId: string
	timelineZoom: number
	activeTool: 'select' | 'trim' | 'split' | 'hand'
}

interface ClipListItemProps {
	item$: Observable<string>
	projectId: string
	timelineZoom: number
	activeTool: 'select' | 'trim' | 'split' | 'hand'
}

const ClipListItem = observer(
	({ item$, projectId, timelineZoom, activeTool }: ClipListItemProps) => {
		const { session$ } = useVideoEditor()
		const clipId = item$.get()
		const selectedEntityId = session$.selectedEntityId.get()

		return (
			<ClipItem
				projectId={projectId}
				clipId={clipId}
				selected={clipId === selectedEntityId}
				timelineZoom={timelineZoom}
				activeTool={activeTool}
			/>
		)
	},
)

export const TrackLabel = observer(({ trackId }: { trackId: string }) => {
	const { projects$ } = useVideoEditor()
	const track$ = projects$.entitiesById[trackId]
	const trackKind = String(track$.attrs.kind.get())
	const isMuted = Boolean(track$.attrs.muted.get())
	const isLocked = Boolean(track$.attrs.locked.get())

	return (
		<div className="ve-track-row__label">
			<div>
				<strong>{String(track$.attrs.name.get())}</strong>
				<small>{trackKind}</small>
			</div>
			<div
				className="ve-track-row__controls"
				aria-label={`${String(track$.attrs.name.get())} controls`}
			>
				<IconButton
					type="button"
					icon={Volume2}
					label={isMuted ? 'Track muted' : 'Track audible'}
					variant={isMuted ? 'secondary' : 'ghost'}
					disabled
				/>
				<IconButton
					type="button"
					icon={Lock}
					label={isLocked ? 'Track locked' : 'Track unlocked'}
					variant={isLocked ? 'secondary' : 'ghost'}
					disabled
				/>
				<IconButton
					type="button"
					icon={Eye}
					label="Track visible"
					variant="ghost"
					disabled
				/>
			</div>
		</div>
	)
})

export const TrackLane = observer(
	({ projectId, trackId, timelineZoom, activeTool }: TrackRowProps) => {
		const { projects$ } = useVideoEditor()
		const track$ = projects$.entitiesById[trackId]
		const clipIds$ = track$.rels.clips as Observable<string[]>
		const clipIds = clipIds$.get()
		const clips = Array.isArray(clipIds) ? clipIds : []
		const trackEnd = clips.reduce((maxEnd, clipId) => {
			const start = Number(projects$.entitiesById[clipId].attrs.start.get())
			const duration = Number(
				projects$.entitiesById[clipId].attrs.duration.get(),
			)
			return Math.max(maxEnd, start + duration)
		}, 0)
		const trackWidth = Math.max(960, Math.ceil((trackEnd + 2) * timelineZoom))

		return (
			<div className="ve-track-row__rail">
				{clips.length === 0 ? (
					<p className="ve-empty">Drop clips here.</p>
				) : (
					<div
						className="ve-track-row__timeline"
						style={{ width: `${trackWidth}px` }}
					>
						<For
							each={clipIds$}
							optimized
							item={ClipListItem}
							itemProps={{ projectId, timelineZoom, activeTool }}
						/>
					</div>
				)}
			</div>
		)
	},
)
