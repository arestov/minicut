import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import type { LucideIcon } from 'lucide-react'
import { Hand, Magnet, MousePointer2, Music, Scissors, StretchHorizontal, Video, ZoomIn, ZoomOut } from 'lucide-react'
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_STEP } from '../legend/sessionStore'
import { IconButton } from './ControlPrimitives'
import { TrackRow } from './TrackRow'

type TimelineTool = 'select' | 'trim' | 'split' | 'hand'

interface TrackListItemProps {
	item$: Observable<string>
	projectId: string
	timelineZoom: number
	activeTool: TimelineTool
}

const TrackListItem = observer(({ item$, projectId, timelineZoom, activeTool }: TrackListItemProps) => {
	const trackId = item$.get()

	return (
		<TrackRow
			projectId={projectId}
			trackId={trackId}
			timelineZoom={timelineZoom}
			activeTool={activeTool}
		/>
	)
})

const timelineTicks = Array.from({ length: 7 }, (_, index) => index * 5)
const timelineTimeOriginPx = 167

const timelineTools: Array<{ id: TimelineTool, label: string, icon: LucideIcon }> = [
	{ id: 'select', label: 'Select tool', icon: MousePointer2 },
	{ id: 'trim', label: 'Trim tool', icon: StretchHorizontal },
	{ id: 'split', label: 'Split tool', icon: Scissors },
	{ id: 'hand', label: 'Hand tool', icon: Hand },
]

export const TimelineView = observer(() => {
	const [activeTool, setActiveTool] = useState<TimelineTool>('select')
	const [snappingEnabled, setSnappingEnabled] = useState(true)
	const panState = useRef<{
		x: number
		y: number
		scrollLeft: number
		scrollTop: number
		railScrollLefts: number[]
	} | null>(null)
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
		if (activeTool === 'hand') {
			return
		}

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

		actions.setCursor(Math.max(0, timelineX / timelineZoom))
		event.preventDefault()
	}

	const handleHandPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (activeTool !== 'hand') {
			return
		}

		if (event.type === 'pointerdown') {
			const rails = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.ve-track-row__rail'))
			panState.current = {
				x: event.clientX,
				y: event.clientY,
				scrollLeft: event.currentTarget.scrollLeft,
				scrollTop: event.currentTarget.scrollTop,
				railScrollLefts: rails.map((rail) => rail.scrollLeft),
			}
			event.currentTarget.setPointerCapture?.(event.pointerId)
			event.preventDefault()
			return
		}

		if (event.type === 'pointermove' && panState.current && (event.buttons & 1) !== 0) {
			const deltaX = event.clientX - panState.current.x
			const deltaY = event.clientY - panState.current.y
			const rails = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.ve-track-row__rail'))
			event.currentTarget.scrollLeft = panState.current.scrollLeft - deltaX
			event.currentTarget.scrollTop = panState.current.scrollTop - deltaY
			rails.forEach((rail, index) => {
				rail.scrollLeft = (panState.current?.railScrollLefts[index] ?? 0) - deltaX
			})
			event.preventDefault()
		}
	}

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			<div className="ve-panel__header">
				<div className="ve-timeline__track-actions">
					<h2>Timeline</h2>
					<IconButton type="button" icon={Video} label="Add video track" variant="outline" onClick={() => actions.addTrack('video')} disabled={!activeProjectId}>
						Add video track
					</IconButton>
					<IconButton type="button" icon={Music} label="Add audio track" variant="outline" onClick={() => actions.addTrack('audio')} disabled={!activeProjectId}>
						Add audio track
					</IconButton>
				</div>
				<div className="ve-timeline__tools" aria-label="Timeline tools">
					<div className="ve-segmented-control ve-timeline-tool-mode" aria-label="Timeline tool mode">
						{timelineTools.map((tool) => (
							<IconButton
								key={tool.id}
								type="button"
								icon={tool.icon}
								label={tool.label}
								data-tool-id={tool.id}
								data-icon-name={tool.id === 'trim' ? 'stretch-horizontal' : tool.id === 'split' ? 'scissors' : tool.id}
								variant={activeTool === tool.id ? 'secondary' : 'ghost'}
								aria-pressed={activeTool === tool.id}
								onClick={() => setActiveTool(tool.id)}
							/>
						))}
					</div>
					<span className="ve-timeline__time" aria-label="Current time">{cursorSeconds.toFixed(2)}s</span>
					<span>{tracks.length} tracks</span>
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
						style={{ '--ve-track-count': tracks.length } as CSSProperties}
						onPointerDown={(event) => {
							handleHandPan(event)
							updateCursorFromPointer(event)
						}}
						onPointerMove={(event) => {
							handleHandPan(event)
							updateCursorFromPointer(event)
						}}
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
									itemProps={{ projectId: activeProjectId, timelineZoom, activeTool }}
								/>
							) : null}
						</div>
					</div>
				</div>
			)}
		</section>
	)
})
