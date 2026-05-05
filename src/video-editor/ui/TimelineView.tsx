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
	useRef,
	useState,
	type CSSProperties,
	type Dispatch,
	type PointerEvent as ReactPointerEvent,
	type ReactElement,
	type SetStateAction,
} from 'react'
import {
	TIMELINE_ZOOM_MAX,
	TIMELINE_ZOOM_MIN,
	TIMELINE_ZOOM_STEP,
} from '../dkt/state/sessionStore'
import {
	EditorScopeProvider,
	ROOT_SCOPE,
	SESSION_SCOPE,
	useEditorActions,
	useEditorAttrs,
	useEditorComp,
	useEditorMany,
	useEditorOne,
	type EditorScopedDispatch,
	type SelectedClipSummary,
} from '../render-sync'
import type { EditorScope } from '../render-sync/EditorScope'
import { IconButton } from './ControlPrimitives'
import { TrackLabel, TrackLane } from './TrackRow'

type TimelineTool = 'select' | 'trim' | 'split' | 'hand'

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

interface TimelineHeaderProps {
	activeTool: TimelineTool
	canZoomIn: boolean
	canZoomOut: boolean
	selectedClipSummary: SelectedClipSummary | null
	sessionDispatch: EditorScopedDispatch
	snappingEnabled: boolean
	setActiveTool: Dispatch<SetStateAction<TimelineTool>>
	setSnappingEnabled: Dispatch<SetStateAction<boolean>>
	timelineZoom: number
	trackCount: number
}

interface TimelineBodyProps {
	activeProjectId: string | null
	activeTool: TimelineTool
	handleHandPan: (event: ReactPointerEvent<HTMLDivElement>) => void
	handlePlayheadPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
	rootDispatch: EditorScopedDispatch
	snappingEnabled: boolean
	stopPlayheadDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
	timelineScope: EditorScope
	timelineZoom: number
	trackScopes: EditorScope[]
	updateCursorFromPointer: (event: ReactPointerEvent<HTMLDivElement>) => void
}

const CurrentTimeLabel = () => {
	const { cursor } = useEditorAttrs<{ cursor?: unknown }>(['cursor'], SESSION_SCOPE)
	const cursorSeconds = Number(cursor)

	return (
		<span className="ve-timeline__time" aria-label="Current time">
			{cursorSeconds.toFixed(2)}s
		</span>
	)
}

const TimelinePlayhead = ({ timelineZoom }: { timelineZoom: number }) => {
	const { cursor } = useEditorAttrs<{ cursor?: unknown }>(['cursor'], SESSION_SCOPE)
	const cursorSeconds = Number(cursor)

	return (
		<div
			className="ve-timeline-playhead"
			aria-label="Current step"
			style={{ left: `${cursorSeconds * timelineZoom}px` }}
		/>
	)
}

const TimelineHeader = ({
	activeTool,
	canZoomIn,
	canZoomOut,
	selectedClipSummary,
	sessionDispatch,
	snappingEnabled,
	setActiveTool,
	setSnappingEnabled,
	timelineZoom,
	trackCount,
}: TimelineHeaderProps) => {
	const hasSelectedClip = Boolean(selectedClipSummary)

	return (
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
					onClick={() => sessionDispatch('splitSelectedClip')}
					disabled={!hasSelectedClip}
				/>
				<IconButton
					type="button"
					icon={MoveLeft}
					label="Nudge -0.5s"
					variant="ghost"
					onClick={() => sessionDispatch('nudgeSelectedClip', { delta: -0.5 })}
					disabled={!hasSelectedClip}
				/>
				<IconButton
					type="button"
					icon={MoveRight}
					label="Nudge +0.5s"
					variant="ghost"
					onClick={() => sessionDispatch('nudgeSelectedClip', { delta: 0.5 })}
					disabled={!hasSelectedClip}
				/>
				<IconButton
					type="button"
					icon={Trash2}
					label="Delete clip"
					variant="ghost"
					onClick={() => sessionDispatch('deleteSelectedClip')}
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
				<span>{trackCount} tracks</span>
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
					onClick={() => sessionDispatch('zoomTimeline', { delta: -TIMELINE_ZOOM_STEP })}
					disabled={!canZoomOut}
				/>
				<span>{Math.round(timelineZoom)} px/s</span>
				<IconButton
					type="button"
					icon={ZoomIn}
					label="Zoom in"
					variant="ghost"
					onClick={() => sessionDispatch('zoomTimeline', { delta: TIMELINE_ZOOM_STEP })}
					disabled={!canZoomIn}
				/>
			</div>
		</div>
	)
}

const TimelineBody = ({
	activeProjectId,
	activeTool,
	handleHandPan,
	handlePlayheadPointerDown,
	rootDispatch,
	snappingEnabled,
	stopPlayheadDrag,
	timelineZoom,
	trackScopes,
	updateCursorFromPointer,
}: TimelineBodyProps) => (
	<div className="ve-timeline__body">
		<div
			className="ve-timeline-scroll-area"
			data-tool={activeTool}
			data-snapping={snappingEnabled ? 'on' : 'off'}
			style={{ '--ve-track-count': trackScopes.length } as CSSProperties}
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
						{trackScopes.map((trackScope) => (
							<EditorScopeProvider key={trackScope.nodeId} scope={trackScope}>
								<TrackLabel trackScope={trackScope} />
							</EditorScopeProvider>
						))}
					</div>
					<div className="ve-track-label-actions" aria-label="Track actions">
						<IconButton
							type="button"
							icon={Video}
							label="Add video track"
							variant="outline"
							onClick={() => rootDispatch('addTrack', { kind: 'video' })}
							disabled={!activeProjectId}
						>
							Video track
						</IconButton>
						<IconButton
							type="button"
							icon={Music}
							label="Add audio track"
							variant="outline"
							onClick={() => rootDispatch('addTrack', { kind: 'audio' })}
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
							{trackScopes.map((trackScope) => (
								<EditorScopeProvider key={trackScope.nodeId} scope={trackScope}>
									<TrackLane
										trackScope={trackScope}
										timelineZoom={timelineZoom}
										activeTool={activeTool}
									/>
								</EditorScopeProvider>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
)

const ActiveTimeline = ({
	activeTool,
	activeProjectId,
	handleHandPan,
	handlePlayheadPointerDown,
	projectScope,
	renderHeader,
	rootDispatch,
	snappingEnabled,
	stopPlayheadDrag,
	timelineZoom,
	updateCursorFromPointer,
}: {
	activeTool: TimelineTool
	activeProjectId: string | null
	handleHandPan: (event: ReactPointerEvent<HTMLDivElement>) => void
	handlePlayheadPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
	projectScope: EditorScope
	renderHeader: (trackCount: number) => ReactElement
	rootDispatch: EditorScopedDispatch
	snappingEnabled: boolean
	stopPlayheadDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
	timelineZoom: number
	updateCursorFromPointer: (event: ReactPointerEvent<HTMLDivElement>) => void
}) => {
	const timelineScope = useEditorOne('activeTimeline', projectScope)

	if (!timelineScope) {
		return (
			<>
				{renderHeader(0)}
				<p className="ve-empty">Create a project to allocate timeline tracks.</p>
			</>
		)
	}

	return (
		<EditorScopeProvider scope={timelineScope}>
			<ResolvedTimeline
				activeTool={activeTool}
				activeProjectId={activeProjectId}
				handleHandPan={handleHandPan}
				handlePlayheadPointerDown={handlePlayheadPointerDown}
				renderHeader={renderHeader}
				rootDispatch={rootDispatch}
				snappingEnabled={snappingEnabled}
				stopPlayheadDrag={stopPlayheadDrag}
				timelineScope={timelineScope}
				timelineZoom={timelineZoom}
				updateCursorFromPointer={updateCursorFromPointer}
			/>
		</EditorScopeProvider>
	)
}

const ResolvedTimeline = ({
	activeTool,
	activeProjectId,
	handleHandPan,
	handlePlayheadPointerDown,
	renderHeader,
	rootDispatch,
	snappingEnabled,
	stopPlayheadDrag,
	timelineScope,
	timelineZoom,
	updateCursorFromPointer,
}: Omit<TimelineBodyProps, 'trackScopes'> & { renderHeader: (trackCount: number) => ReactElement }) => {
	const trackScopes = useEditorMany('tracks', timelineScope)

	return (
		<>
			{renderHeader(trackScopes.length)}
			<TimelineBody
				activeProjectId={activeProjectId}
				activeTool={activeTool}
				handleHandPan={handleHandPan}
				handlePlayheadPointerDown={handlePlayheadPointerDown}
				rootDispatch={rootDispatch}
				snappingEnabled={snappingEnabled}
				stopPlayheadDrag={stopPlayheadDrag}
				timelineScope={timelineScope}
				timelineZoom={timelineZoom}
				trackScopes={trackScopes}
				updateCursorFromPointer={updateCursorFromPointer}
			/>
		</>
	)
}

export const TimelineView = () => {
	const [activeTool, setActiveTool] = useState<TimelineTool>('select')
	const [snappingEnabled, setSnappingEnabled] = useState(true)
	const panState = useRef<{
		x: number
		scrollLeft: number
	} | null>(null)
	const playheadDragPointerId = useRef<number | null>(null)
	const rootAttrs = useEditorAttrs<{ activeProjectId?: unknown }>(['activeProjectId'], ROOT_SCOPE)
	const sessionAttrs = useEditorAttrs<{ timelineZoom?: unknown }>(['timelineZoom'], SESSION_SCOPE)
	const selectedClipSummary = useEditorComp<SelectedClipSummary | null>('selectedClipSummary', SESSION_SCOPE)
	const projectScope = useEditorOne('activeProject', ROOT_SCOPE)
	const sessionDispatch = useEditorActions(SESSION_SCOPE)
	const rootDispatch = useEditorActions(ROOT_SCOPE)
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
	const timelineZoom = Number(sessionAttrs.timelineZoom)
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
		sessionDispatch('setCursor', { value: Math.max(0, timelineX / timelineZoom) })
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

	const renderHeader = (trackCount: number) => (
		<TimelineHeader
			activeTool={activeTool}
			canZoomIn={canZoomIn}
			canZoomOut={canZoomOut}
			selectedClipSummary={selectedClipSummary}
			sessionDispatch={sessionDispatch}
			snappingEnabled={snappingEnabled}
			setActiveTool={setActiveTool}
			setSnappingEnabled={setSnappingEnabled}
			timelineZoom={timelineZoom}
			trackCount={trackCount}
		/>
	)

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			{!activeProjectId || !projectScope ? (
				<>
					{renderHeader(0)}
					<p className="ve-empty">
						Create a project to allocate timeline tracks.
					</p>
				</>
			) : (
				<EditorScopeProvider scope={projectScope}>
					<ActiveTimeline
						activeTool={activeTool}
						activeProjectId={activeProjectId}
						handleHandPan={handleHandPan}
						handlePlayheadPointerDown={handlePlayheadPointerDown}
						projectScope={projectScope}
						renderHeader={renderHeader}
						rootDispatch={rootDispatch}
						snappingEnabled={snappingEnabled}
						stopPlayheadDrag={stopPlayheadDrag}
						timelineZoom={timelineZoom}
						updateCursorFromPointer={updateCursorFromPointer}
					/>
				</EditorScopeProvider>
			)}
		</section>
	)
}
