import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import type { LucideIcon } from 'lucide-react'
import {
	Hand,
	Magnet,
	MoveLeft,
	MoveRight,
	MousePointer2,
	Music,
	Scissors,
	StretchHorizontal,
	Trash2,
	Video,
	ZoomIn,
	ZoomOut,
} from 'lucide-react'
import {
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
} from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { createSelectedClipTrackPosition$ } from '../legend/derivedTimeline'
import {
	TIMELINE_ZOOM_MAX,
	TIMELINE_ZOOM_MIN,
	TIMELINE_ZOOM_STEP,
} from '../legend/sessionStore'
import {
	clipAttrs$,
	clipRels$,
	getActiveProjectId$,
	getActiveTimelineId$,
	getTimelineTrackIds$,
	getTimelineTrackIdsNode$,
	resourceAttrs$,
} from '../legend/observableSelectors'
import { IconButton } from './ControlPrimitives'
import { TrackLabel, TrackLane } from './TrackRow'

type TimelineTool = 'select' | 'trim' | 'split' | 'hand'

interface TrackLabelListItemProps {
	item$: Observable<string>
}

const TrackLabelListItem = observer(({ item$ }: TrackLabelListItemProps) => {
	const trackId = item$.get()

	return <TrackLabel trackId={trackId} />
})

interface TrackLaneListItemProps {
	item$: Observable<string>
	projectId: string
	timelineZoom: number
	activeTool: TimelineTool
}

const TrackLaneListItem = observer(
	({ item$, projectId, timelineZoom, activeTool }: TrackLaneListItemProps) => {
		const trackId = item$.get()

		return (
			<TrackLane
				projectId={projectId}
				trackId={trackId}
				timelineZoom={timelineZoom}
				activeTool={activeTool}
			/>
		)
	},
)

const timelineTicks = Array.from({ length: 7 }, (_, index) => index * 5)

const timelineTools: Array<{
	id: TimelineTool
	label: string
	icon: LucideIcon
}> = [
	{ id: 'select', label: 'Select tool', icon: MousePointer2 },
	{ id: 'trim', label: 'Trim tool', icon: StretchHorizontal },
	{ id: 'split', label: 'Split tool', icon: Scissors },
	{ id: 'hand', label: 'Hand tool', icon: Hand },
]

const CurrentTimeLabel = observer(() => {
	const { session$ } = useVideoEditor()
	const cursorSeconds = session$.cursor.get()

	return (
		<span className="ve-timeline__time" aria-label="Current time">
			{cursorSeconds.toFixed(2)}s
		</span>
	)
})

const TimelinePlayhead = observer(({ timelineZoom }: { timelineZoom: number }) => {
	const { session$ } = useVideoEditor()
	const cursorSeconds = session$.cursor.get()

	return (
		<div
			className="ve-timeline-playhead"
			aria-label="Current step"
			style={{ left: `${cursorSeconds * timelineZoom}px` }}
		/>
	)
})

export const TimelineView = observer(() => {
	const [activeTool, setActiveTool] = useState<TimelineTool>('select')
	const [snappingEnabled, setSnappingEnabled] = useState(true)
	const panState = useRef<{
		x: number
		scrollLeft: number
	} | null>(null)
	const playheadDragPointerId = useRef<number | null>(null)
	const { projects$, session$, actions } = useVideoEditor()
	const activeProjectId = getActiveProjectId$(projects$, session$)
	const timelineZoom = session$.timelineZoom.get()
	const timelineId = getActiveTimelineId$(projects$, activeProjectId)
	const tracks = getTimelineTrackIds$(projects$, timelineId)
	const trackIds$ = getTimelineTrackIdsNode$(projects$, timelineId)
	const selectedEntityId = session$.selectedEntityId.get()
	const selectedEntityType = selectedEntityId ? projects$.entitiesById[selectedEntityId]?.type.get() : null
	const hasSelectedClip = selectedEntityType === 'clip'
	const selectedClipTrackPosition$ = useMemo(
		() => createSelectedClipTrackPosition$(projects$, session$),
		[projects$, session$],
	)
	const selectedClipTrackPosition = selectedClipTrackPosition$.get()
	const selectedClipSummary = hasSelectedClip && selectedEntityId
		? (() => {
				const clip$ = clipAttrs$(projects$, selectedEntityId)
				const resourceId = clipRels$(projects$, selectedEntityId).resource.get()
				const resourceName = resourceId
					? String(resourceAttrs$(projects$, resourceId).name.get())
					: String(clip$.name.get())

				return {
					color: String(clip$.color.get() ?? '#2563eb'),
					resourceName,
					trackName: selectedClipTrackPosition?.trackName ?? 'Track',
				}
			})()
		: null
	const canZoomOut = timelineZoom > TIMELINE_ZOOM_MIN
	const canZoomIn = timelineZoom < TIMELINE_ZOOM_MAX

	const canStartPlayheadDrag = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
		if (activeTool === 'hand') {
			return false
		}

		const target = event.target as HTMLElement | null
		return !(
			target?.closest('.ve-clip') ||
			target?.closest('button, input, label')
		)
	}

	const updateCursorFromPointer = (
		event: ReactPointerEvent<HTMLDivElement>,
	): void => {
		if (playheadDragPointerId.current !== event.pointerId) {
			return
		}

		if ((event.buttons & 1) === 0) {
			playheadDragPointerId.current = null
			return
		}

		const rect = event.currentTarget.getBoundingClientRect()
		const timelineX = event.clientX - rect.left + event.currentTarget.scrollLeft
		actions.setCursor(Math.max(0, timelineX / timelineZoom))
		event.preventDefault()
	}

	const handlePlayheadPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (!canStartPlayheadDrag(event)) {
			return
		}

		playheadDragPointerId.current = event.pointerId
		event.currentTarget.setPointerCapture?.(event.pointerId)
		updateCursorFromPointer(event)
	}

	const stopPlayheadDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (playheadDragPointerId.current !== event.pointerId) {
			return
		}

		playheadDragPointerId.current = null
		event.currentTarget.releasePointerCapture?.(event.pointerId)
	}

	const handleHandPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (activeTool !== 'hand') {
			return
		}

		if (event.type === 'pointerdown') {
			panState.current = {
				x: event.clientX,
				scrollLeft: event.currentTarget.scrollLeft,
			}
			event.currentTarget.setPointerCapture?.(event.pointerId)
			event.preventDefault()
			return
		}

		if (event.type === 'pointermove' && panState.current) {
			const deltaX = event.clientX - panState.current.x
			event.currentTarget.scrollLeft = panState.current.scrollLeft - deltaX
			event.preventDefault()
			return
		}

		if ((event.type === 'pointerup' || event.type === 'pointercancel') && panState.current) {
			panState.current = null
			event.currentTarget.releasePointerCapture?.(event.pointerId)
		}
	}

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			<div className="ve-panel__header">
				<div className="ve-timeline__track-actions">
					<h2>Timeline</h2>
				</div>
				<div className="ve-timeline-clip-actions" aria-label="Clip edit actions">
					{selectedClipSummary ? (
						<div
							className="ve-clip-action-target"
							aria-label="Selected clip action target"
							style={{ borderColor: selectedClipSummary.color }}
						>
							<span>{selectedClipSummary.resourceName}</span>
							<strong>{selectedClipSummary.trackName}</strong>
						</div>
					) : null}
					<IconButton
						type="button"
						icon={Scissors}
						label="Split clip"
						variant="ghost"
						onClick={() => actions.splitSelectedClip()}
						disabled={!hasSelectedClip}
					/>
					<IconButton
						type="button"
						icon={MoveLeft}
						label="Nudge -0.5s"
						variant="ghost"
						onClick={() => actions.nudgeSelectedClip(-0.5)}
						disabled={!hasSelectedClip}
					/>
					<IconButton
						type="button"
						icon={MoveRight}
						label="Nudge +0.5s"
						variant="ghost"
						onClick={() => actions.nudgeSelectedClip(0.5)}
						disabled={!hasSelectedClip}
					/>
					<IconButton
						type="button"
						icon={Trash2}
						label="Delete clip"
						variant="ghost"
						onClick={() => actions.deleteSelectedClip()}
						disabled={!hasSelectedClip}
					/>
				</div>
				<div className="ve-timeline__tools" aria-label="Timeline tools">
					<div
						className="ve-segmented-control ve-timeline-tool-mode"
						aria-label="Timeline tool mode"
					>
						{timelineTools.map((tool) => (
							<IconButton
								key={tool.id}
								type="button"
								icon={tool.icon}
								label={tool.label}
								data-tool-id={tool.id}
								data-icon-name={
									tool.id === 'trim'
										? 'stretch-horizontal'
										: tool.id === 'split'
											? 'scissors'
											: tool.id
								}
								variant={activeTool === tool.id ? 'secondary' : 'ghost'}
								aria-pressed={activeTool === tool.id}
								onClick={() => setActiveTool(tool.id)}
							/>
						))}
					</div>
					<CurrentTimeLabel />
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
				<p className="ve-empty">
					Create a project to allocate timeline tracks.
				</p>
			) : (
				<div className="ve-timeline__body">
					<div
						className="ve-timeline-scroll-area"
						data-tool={activeTool}
						data-snapping={snappingEnabled ? 'on' : 'off'}
						style={{ '--ve-track-count': tracks.length } as CSSProperties}
					>
						<div className="ve-timeline-sticky-row">
							<div className="ve-timeline-label-spacer" aria-hidden="true" />
							<div className="ve-timeline-ruler-row">
								<div className="ve-timeline-ruler" aria-label="Time ruler">
									{timelineTicks.map((tick) => (
										<span
											key={tick}
											style={{ left: `${tick * timelineZoom}px` }}
										>
											{tick}s
										</span>
									))}
								</div>
							</div>
						</div>
						<div className="ve-timeline-grid">
							<div className="ve-track-label-column">
								<div className="ve-track-label-list">
									{trackIds$ ? (
										<For each={trackIds$} optimized item={TrackLabelListItem} />
									) : null}
								</div>
								<div className="ve-track-label-actions" aria-label="Track actions">
									<IconButton
										type="button"
										icon={Video}
										label="Add video track"
										variant="outline"
										onClick={() => actions.addTrack('video')}
										disabled={!activeProjectId}
									>
										Video track
									</IconButton>
									<IconButton
										type="button"
										icon={Music}
										label="Add audio track"
										variant="outline"
										onClick={() => actions.addTrack('audio')}
										disabled={!activeProjectId}
									>
										Audio track
									</IconButton>
								</div>
							</div>
							<div
								className="ve-track-lane-scroll"
								data-tool={activeTool}
								data-snapping={snappingEnabled ? 'on' : 'off'}
								onPointerDown={(event) => {
									handleHandPan(event)
									handlePlayheadPointerDown(event)
								}}
								onPointerMove={(event) => {
									handleHandPan(event)
									updateCursorFromPointer(event)
								}}
								onPointerUp={(event) => {
									handleHandPan(event)
									stopPlayheadDrag(event)
								}}
								onPointerCancel={(event) => {
									handleHandPan(event)
									stopPlayheadDrag(event)
								}}
							>
								<div className="ve-track-lane-column">
									<TimelinePlayhead timelineZoom={timelineZoom} />
									<div className="ve-track-lane-list">
										{trackIds$ ? (
											<For
												each={trackIds$}
												optimized
												item={TrackLaneListItem}
												itemProps={{
													projectId: activeProjectId,
													timelineZoom,
													activeTool,
												}}
											/>
										) : null}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</section>
	)
})
