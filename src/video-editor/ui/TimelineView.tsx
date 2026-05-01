import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import { Hand, Magnet, MousePointer2, Music, Scissors, Video, ZoomIn, ZoomOut } from 'lucide-react'
import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_STEP } from '../legend/sessionStore'
import { IconButton } from './ControlPrimitives'
import { TrackRow } from './TrackRow'

type TimelineTool = 'select' | 'trim' | 'split' | 'hand'

interface TrackListItemProps {
	item$: Observable<string>
	projectId: string
	timelineZoom: number
}

const TrackListItem = observer(({ item$, projectId, timelineZoom }: TrackListItemProps) => {
	const trackId = item$.get()

	return (
		<TrackRow
			projectId={projectId}
			trackId={trackId}
			timelineZoom={timelineZoom}
		/>
	)
})

const timelineTicks = Array.from({ length: 7 }, (_, index) => index * 5)
const cursorRangeMax = 20
const timelineTimeOriginPx = 167

const timelineTools: Array<{ id: TimelineTool, label: string, icon: typeof MousePointer2 }> = [
	{ id: 'select', label: 'Select tool', icon: MousePointer2 },
	{ id: 'trim', label: 'Trim tool', icon: Scissors },
	{ id: 'split', label: 'Split tool', icon: Scissors },
	{ id: 'hand', label: 'Hand tool', icon: Hand },
]

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const TimelineView = observer(() => {
	const [activeTool, setActiveTool] = useState<TimelineTool>('select')
	const [snappingEnabled, setSnappingEnabled] = useState(true)
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const timelineZoom = session$.timelineZoom.get()
	const cursorSeconds = session$.cursor.get()
	const activeProject$ = activeProjectId ? projects$.projects[activeProjectId] : null
	const rootEntityId = activeProject$?.rootEntityId.get()
	const timelineId = rootEntityId
		? projects$.entitiesById[rootEntityId].rels.activeTimeline.get()
		: null
	const trackIds =
		typeof timelineId === 'string'
			? projects$.entitiesById[timelineId].rels.tracks.get()
			: []
	const tracks = Array.isArray(trackIds) ? trackIds : []
	const trackIds$ =
		typeof timelineId === 'string'
			? (projects$.entitiesById[timelineId].rels.tracks as Observable<string[]>)
			: null
	const canZoomOut = timelineZoom > TIMELINE_ZOOM_MIN
	const canZoomIn = timelineZoom < TIMELINE_ZOOM_MAX

	const updateCursorFromPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (event.type === 'pointermove' && (event.buttons & 1) === 0) {
			return
		}

		const target = event.target as HTMLElement | null
		if (target?.closest('.ve-clip') || target?.closest('button, input, label')) {
			return
		}

		const rect = event.currentTarget.getBoundingClientRect()
		const timelineX = event.clientX - rect.left - timelineTimeOriginPx
		if (timelineX < 0) {
			return
		}

		actions.setCursor(clamp(timelineX / timelineZoom, 0, cursorRangeMax))
		event.preventDefault()
	}

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			<div className="ve-panel__header">
				<h2>Timeline</h2>
				<div className="ve-timeline__tools" aria-label="Timeline tools">
					<div className="ve-segmented-control ve-timeline-tool-mode" aria-label="Timeline tool mode">
						{timelineTools.map((tool) => (
							<IconButton
								key={tool.id}
								type="button"
								icon={tool.icon}
								label={tool.label}
								variant={activeTool === tool.id ? 'secondary' : 'ghost'}
								aria-pressed={activeTool === tool.id}
								onClick={() => setActiveTool(tool.id)}
							/>
						))}
					</div>
					<span className="ve-timeline__time" aria-label="Current time">{cursorSeconds.toFixed(2)}s</span>
					<span>{tracks.length} tracks</span>
					<IconButton type="button" icon={Video} label="Add video track" variant="outline" onClick={() => actions.addTrack('video')} disabled={!activeProjectId}>
						Add video track
					</IconButton>
					<IconButton type="button" icon={Music} label="Add audio track" variant="outline" onClick={() => actions.addTrack('audio')} disabled={!activeProjectId}>
						Add audio track
					</IconButton>
					<IconButton
						type="button"
						icon={Magnet}
						label="Toggle snapping"
						variant={snappingEnabled ? 'secondary' : 'ghost'}
						aria-pressed={snappingEnabled}
						onClick={() => setSnappingEnabled((value) => !value)}
					/>
					<IconButton
						type="button"
						icon={ZoomOut}
						label="Zoom out"
						variant="ghost"
						onClick={() => actions.zoomTimeline(-TIMELINE_ZOOM_STEP)}
						disabled={!canZoomOut}
					/>
					<span>{Math.round(timelineZoom)} px/s</span>
					<IconButton
						type="button"
						icon={ZoomIn}
						label="Zoom in"
						variant="ghost"
						onClick={() => actions.zoomTimeline(TIMELINE_ZOOM_STEP)}
						disabled={!canZoomIn}
					/>
				</div>
			</div>
			{!activeProjectId ? (
				<p className="ve-empty">Create a project to allocate timeline tracks.</p>
			) : (
				<div className="ve-timeline__body">
					<div
						className="ve-timeline-scroll-area"
						data-tool={activeTool}
						data-snapping={snappingEnabled ? 'on' : 'off'}
						onPointerDown={updateCursorFromPointer}
						onPointerMove={updateCursorFromPointer}
					>
						<div className="ve-timeline-ruler" aria-label="Time ruler">
							{timelineTicks.map((tick) => (
								<span key={tick} style={{ left: `${tick * timelineZoom}px` }}>
									{tick}s
								</span>
							))}
						</div>
						<div
							className="ve-timeline-playhead"
							aria-label="Current step"
							style={{ left: `calc(${timelineTimeOriginPx}px + ${cursorSeconds * timelineZoom}px)` }}
						/>
						<div className="ve-track-list">
							{trackIds$ ? (
								<For
									each={trackIds$}
									optimized
									item={TrackListItem}
									itemProps={{ projectId: activeProjectId, timelineZoom }}
								/>
							) : null}
						</div>
					</div>
				</div>
			)}
		</section>
	)
})
