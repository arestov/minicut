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
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useActions } from '../../dkt-react-sync/hooks/useActions'
import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import { useMany } from '../../dkt-react-sync/hooks/useMany'
import { useRootAttrs } from '../../dkt-react-sync/hooks/useRootAttrs'
import { useRootDispatch } from '../../dkt-react-sync/hooks/useRootDispatch'
import { useRootOne } from '../../dkt-react-sync/hooks/useRootOne'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import {
	TIMELINE_ZOOM_MAX,
	TIMELINE_ZOOM_MIN,
	TIMELINE_ZOOM_STEP,
} from '../models/sessionZoom'
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

interface SelectedClipSummary {
	color: string
	resourceName: string
	trackName: string
}

interface TimelineHeaderProps {
	activeTool: TimelineTool
	canZoomIn: boolean
	canZoomOut: boolean
	onDeleteSelected: () => void
	onNudgeSelected: (delta: number) => void
	onSplitSelected: () => void
	onZoom: (delta: number) => void
	selectedClipSummary: SelectedClipSummary | null
	snappingEnabled: boolean
	setActiveTool: Dispatch<SetStateAction<TimelineTool>>
	setSnappingEnabled: Dispatch<SetStateAction<boolean>>
	cursorSeconds: number
	timelineZoom: number
	trackCount: number
}

interface TimelineBodyProps {
	activeProjectId: string | null
	activeTool: TimelineTool
	handleHandPan: (event: ReactPointerEvent<HTMLDivElement>) => void
	handlePlayheadPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
	onAddTrack: (kind: 'video' | 'audio') => void
	snappingEnabled: boolean
	stopPlayheadDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
	cursorSeconds: number
	selectedEntityId: string | null
	timelineZoom: number
	trackItems: readonly ReactSyncScopeHandle[]
	updateCursorFromPointer: (event: ReactPointerEvent<HTMLDivElement>) => void
}

const CurrentTimeLabel = ({ cursorSeconds }: { cursorSeconds: number }) => {
	return (
		<span className="ve-timeline__time" aria-label="Current time">
			{cursorSeconds.toFixed(2)}s
		</span>
	)
}

const TimelinePlayhead = ({ cursorSeconds, timelineZoom }: { cursorSeconds: number; timelineZoom: number }) => {
	return <div className="ve-timeline-playhead" aria-label="Current step" style={{ left: `${cursorSeconds * timelineZoom}px` }} />
}

const TimelineHeader = ({
	activeTool,
	canZoomIn,
	canZoomOut,
	onDeleteSelected,
	onNudgeSelected,
	onSplitSelected,
	onZoom,
	selectedClipSummary,
	snappingEnabled,
	setActiveTool,
	setSnappingEnabled,
	cursorSeconds,
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
					<div className="ve-clip-action-target" aria-label="Selected clip action target" style={{ borderColor: selectedClipSummary.color }}>
						<span>{selectedClipSummary.resourceName}</span>
						<strong>{selectedClipSummary.trackName}</strong>
					</div>
				) : null}
				<IconButton type="button" icon={Scissors} label="Split clip" variant="ghost" onClick={onSplitSelected} disabled={!hasSelectedClip} />
				<IconButton type="button" icon={MoveLeft} label="Nudge -0.5s" variant="ghost" onClick={() => onNudgeSelected(-0.5)} disabled={!hasSelectedClip} />
				<IconButton type="button" icon={MoveRight} label="Nudge +0.5s" variant="ghost" onClick={() => onNudgeSelected(0.5)} disabled={!hasSelectedClip} />
				<IconButton type="button" icon={Trash2} label="Delete clip" variant="ghost" onClick={onDeleteSelected} disabled={!hasSelectedClip} />
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
				<CurrentTimeLabel cursorSeconds={cursorSeconds} />
				<span>{trackCount} tracks</span>
				<IconButton type="button" icon={Magnet} label="Toggle snapping" variant={snappingEnabled ? 'secondary' : 'ghost'} aria-pressed={snappingEnabled} onClick={() => setSnappingEnabled((value) => !value)} />
				<IconButton type="button" icon={ZoomOut} label="Zoom out" variant="ghost" onClick={() => onZoom(-TIMELINE_ZOOM_STEP)} disabled={!canZoomOut} />
				<span>{Math.round(timelineZoom)} px/s</span>
				<IconButton type="button" icon={ZoomIn} label="Zoom in" variant="ghost" onClick={() => onZoom(TIMELINE_ZOOM_STEP)} disabled={!canZoomIn} />
			</div>
		</div>
	)
}

const TimelineBody = ({
	activeProjectId,
	activeTool,
	handleHandPan,
	handlePlayheadPointerDown,
	onAddTrack,
	snappingEnabled,
	stopPlayheadDrag,
	cursorSeconds,
	selectedEntityId,
	timelineZoom,
	trackItems,
	updateCursorFromPointer,
}: TimelineBodyProps) => (
	<div className="ve-timeline__body">
		<div className="ve-timeline-scroll-area" data-tool={activeTool} data-snapping={snappingEnabled ? 'on' : 'off'} style={{ '--ve-track-count': trackItems.length } as CSSProperties}>
			<div className="ve-timeline-sticky-row">
				<div className="ve-timeline-label-spacer" aria-hidden="true" />
				<div className="ve-timeline-ruler-row">
					<div className="ve-timeline-ruler" aria-label="Time ruler">
						{timelineTicks.map((tick) => <span key={tick} style={{ left: `${tick * timelineZoom}px` }}>{tick}s</span>)}
					</div>
				</div>
			</div>
			<div className="ve-timeline-grid">
				<div className="ve-track-label-column">
					<div className="ve-track-label-list">
						{trackItems.map((trackScope) => (
							<ScopeContext.Provider key={trackScope._nodeId} value={trackScope}>
								<TrackLabel />
							</ScopeContext.Provider>
						))}
					</div>
					<div className="ve-track-label-actions" aria-label="Track actions">
						<IconButton type="button" icon={Video} label="Add video track" variant="outline" onClick={() => onAddTrack('video')} disabled={!activeProjectId}>Video track</IconButton>
						<IconButton type="button" icon={Music} label="Add audio track" variant="outline" onClick={() => onAddTrack('audio')} disabled={!activeProjectId}>Audio track</IconButton>
					</div>
				</div>
				<div
					className="ve-track-lane-scroll"
					data-tool={activeTool}
					data-snapping={snappingEnabled ? 'on' : 'off'}
					onPointerDown={(event) => { handleHandPan(event); handlePlayheadPointerDown(event) }}
					onPointerMove={(event) => { handleHandPan(event); updateCursorFromPointer(event) }}
					onPointerUp={(event) => { handleHandPan(event); stopPlayheadDrag(event) }}
					onPointerCancel={(event) => { handleHandPan(event); stopPlayheadDrag(event) }}
				>
					<div className="ve-track-lane-column">
						<TimelinePlayhead cursorSeconds={cursorSeconds} timelineZoom={timelineZoom} />
						<div className="ve-track-lane-list">
							{trackItems.map((trackScope) => (
								<ScopeContext.Provider key={trackScope._nodeId} value={trackScope}>
									<TrackLane timelineZoom={timelineZoom} activeTool={activeTool} selectedEntityId={selectedEntityId} />
								</ScopeContext.Provider>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
)

const ResolvedProjectTimeline = ({
	activeProjectId,
	activeTool,
	handleHandPan,
	handlePlayheadPointerDown,
	onAddTrack,
	renderHeader,
	snappingEnabled,
	stopPlayheadDrag,
	cursorSeconds,
	selectedEntityId,
	timelineZoom,
	updateCursorFromPointer,
}: Omit<TimelineBodyProps, 'trackItems'> & { renderHeader: (trackCount: number) => ReactElement }) => {
	const trackItems = useMany('tracks')

	return (
		<>
			{renderHeader(trackItems.length)}
			<TimelineBody
				activeProjectId={activeProjectId}
				activeTool={activeTool}
				handleHandPan={handleHandPan}
				handlePlayheadPointerDown={handlePlayheadPointerDown}
				onAddTrack={onAddTrack}
				snappingEnabled={snappingEnabled}
				stopPlayheadDrag={stopPlayheadDrag}
				cursorSeconds={cursorSeconds}
				selectedEntityId={selectedEntityId}
				timelineZoom={timelineZoom}
				trackItems={trackItems}
				updateCursorFromPointer={updateCursorFromPointer}
			/>
		</>
	)
}

export const TimelineView = () => {
	const [activeTool, setActiveTool] = useState<TimelineTool>('select')
	const [snappingEnabled, setSnappingEnabled] = useState(true)
	const panState = useRef<{ x: number; scrollLeft: number } | null>(null)
	const playheadDragPointerId = useRef<number | null>(null)
	// session-scope attrs read via root hooks (we're inside ActiveProjectScope)
	const rootAttrs = useRootAttrs(['activeProjectId', 'timelineZoom', 'selectedEntityId', 'cursor', 'selectedClipSummary']) as { activeProjectId?: unknown; timelineZoom?: unknown; selectedEntityId?: unknown; cursor?: unknown; selectedClipSummary?: SelectedClipSummary | null }
	const activeProjectId = typeof rootAttrs.activeProjectId === 'string' ? rootAttrs.activeProjectId : null
	const selectedEntityId = typeof rootAttrs.selectedEntityId === 'string' ? rootAttrs.selectedEntityId : null
	const timelineZoom = Number(rootAttrs.timelineZoom)
	const cursorSeconds = Number(rootAttrs.cursor ?? 0)
	const selectedClipSummary = rootAttrs.selectedClipSummary ?? null
	const canZoomOut = timelineZoom > TIMELINE_ZOOM_MIN
	const canZoomIn = timelineZoom < TIMELINE_ZOOM_MAX
	// session dispatch for simple session actions
	const sessionDispatch = useRootDispatch()
	const runtime = useReactScopeRuntime()
	const selectedClipScope = useRootOne('selectedClip')
	const selectedClipDispatch = selectedClipScope ? runtime.getDispatch(selectedClipScope) : null
	// project dispatch for addTrack — scope = activeProject via ActiveProjectScope
	const projectDispatch = useActions()

	const canStartPlayheadDrag = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
		if (activeTool === 'hand') {
			return false
		}

		const target = event.target as HTMLElement | null
		return !(target?.closest('.ve-clip') || target?.closest('button, input, label'))
	}

	const updateCursorFromPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (playheadDragPointerId.current !== event.pointerId) {
			return
		}

		if ((event.buttons & 1) === 0) {
			playheadDragPointerId.current = null
			return
		}

		const rect = event.currentTarget.getBoundingClientRect()
		const timelineX = event.clientX - rect.left + event.currentTarget.scrollLeft
		sessionDispatch('setCursor', Math.max(0, timelineX / timelineZoom))
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
			panState.current = { x: event.clientX, scrollLeft: event.currentTarget.scrollLeft }
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
			onDeleteSelected={() => sessionDispatch('deleteSelectedClip')}
			onNudgeSelected={(delta) => selectedClipDispatch?.('moveBy', { delta })}
			onSplitSelected={() => sessionDispatch('splitSelectedClip')}
			onZoom={(delta) => sessionDispatch('zoomTimeline', delta)}
			selectedClipSummary={selectedClipSummary}
			snappingEnabled={snappingEnabled}
			setActiveTool={setActiveTool}
			setSnappingEnabled={setSnappingEnabled}
			cursorSeconds={cursorSeconds}
			timelineZoom={timelineZoom}
			trackCount={trackCount}
		/>
	)

	return (
		<section className="ve-panel ve-timeline" aria-label="Timeline">
			{!activeProjectId ? (
				<>
					{renderHeader(0)}
					<p className="ve-empty">Create a project to allocate timeline tracks.</p>
				</>
			) : (
				<ResolvedProjectTimeline
					activeProjectId={activeProjectId}
					activeTool={activeTool}
					handleHandPan={handleHandPan}
					handlePlayheadPointerDown={handlePlayheadPointerDown}
					onAddTrack={(kind) => projectDispatch('addTrack', kind)}
					renderHeader={renderHeader}
					snappingEnabled={snappingEnabled}
					stopPlayheadDrag={stopPlayheadDrag}
					cursorSeconds={cursorSeconds}
					selectedEntityId={selectedEntityId}
					timelineZoom={timelineZoom}
					updateCursorFromPointer={updateCursorFromPointer}
				/>
			)}
		</section>
	)
}
