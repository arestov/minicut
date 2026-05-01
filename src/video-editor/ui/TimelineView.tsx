import type { Observable } from '@legendapp/state'
import { For, observer } from '@legendapp/state/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { TrackRow } from './TrackRow'

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
const timelineTimeOriginPx = 151

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const TimelineView = observer(() => {
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
					<span className="ve-timeline__time" aria-label="Current time">{cursorSeconds.toFixed(2)}s</span>
					<span>{tracks.length} tracks</span>
					<button type="button" onClick={() => actions.addTrack('video')} disabled={!activeProjectId}>
						Add video track
					</button>
					<button type="button" onClick={() => actions.addTrack('audio')} disabled={!activeProjectId}>
						Add audio track
					</button>
					<button type="button" onClick={() => actions.zoomTimeline(-8)} aria-label="Zoom out">
						Zoom out
					</button>
					<span>{Math.round(timelineZoom)} px/s</span>
					<button type="button" onClick={() => actions.zoomTimeline(8)} aria-label="Zoom in">
						Zoom in
					</button>
				</div>
			</div>
			{!activeProjectId ? (
				<p className="ve-empty">Create a project to allocate timeline tracks.</p>
			) : (
				<div className="ve-timeline__body">
					<label className="ve-timeline-cursor-control">
						<span>Cursor</span>
						<input
							type="range"
							min="0"
							max={String(cursorRangeMax)}
							step="0.01"
							value={cursorSeconds}
							onChange={(event) => actions.setCursor(Number(event.currentTarget.value))}
						/>
					</label>
					<div
						className="ve-timeline-scroll-area"
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
							style={{ left: `calc(151px + ${cursorSeconds * timelineZoom}px)` }}
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
