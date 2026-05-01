import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import { Eye, Lock, Volume2 } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	clipAttrs$,
	getTrackClipIds$,
	getTrackClipIdsNode$,
	trackAttrs$,
} from '../legend/observableSelectors'
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
	const track$ = trackAttrs$(projects$, trackId)
	const trackName = String(track$.name.get())
	const trackKind = String(track$.kind.get())
	const isMuted = Boolean(track$.muted.get())
	const isLocked = Boolean(track$.locked.get())

	return (
		<div className="ve-track-row__label">
			<div>
				<strong>{trackName}</strong>
				<small>{trackKind}</small>
			</div>
			<div
				className="ve-track-row__controls"
				aria-label={`${trackName} controls`}
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
		const clipIds$ = getTrackClipIdsNode$(projects$, trackId)
		const clips = getTrackClipIds$(projects$, trackId)
		const trackEnd = clips.reduce((maxEnd, clipId) => {
			const clip$ = clipAttrs$(projects$, clipId)
			const start = Number(clip$.start.get())
			const duration = Number(clip$.duration.get())
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
