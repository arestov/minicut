import { observer } from '@legendapp/state/react'
import { useRef } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatPercent, formatSeconds } from './format'

type ClipPointerDragState =
	| { kind: 'move'; startX: number }
	| { kind: 'resize-start' | 'resize-end'; startX: number }

interface ClipItemProps {
	projectId: string
	clipId: string
	selected: boolean
	timelineZoom: number
	activeTool: 'select' | 'trim' | 'split' | 'hand'
}

export const ClipItem = observer(({ projectId, clipId, selected, timelineZoom, activeTool }: ClipItemProps) => {
	const { projects$, actions } = useVideoEditor()
	const dragState = useRef<ClipPointerDragState | null>(null)
	const clip$ = projects$.entitiesById[clipId]
	const name = String(clip$.attrs.name.get())
	const start = Number(clip$.attrs.start.get())
	const duration = Number(clip$.attrs.duration.get())
	const opacity = Number(clip$.attrs.opacity.value.get())
	const color = String(clip$.attrs.color.get() ?? '#2563eb')
	const width = Math.max(36, duration * timelineZoom)
	const left = Math.max(0, start * timelineZoom)
	const splitAtPointer = (clientX: number, element: HTMLElement): void => {
		const rect = element.getBoundingClientRect()
		const localTime = Math.max(0, (clientX - rect.left) / timelineZoom)
		actions.splitClipByIdAt(clipId, start + localTime)
	}
	const finishPointerDrag = (clientX: number): void => {
		const state = dragState.current
		dragState.current = null
		if (!state) {
			return
		}

		const deltaSeconds = Math.round(((clientX - state.startX) / timelineZoom) * 2) / 2
		if (deltaSeconds === 0) {
			return
		}

		actions.selectEntity(clipId)
		if (state.kind === 'move' && activeTool === 'select') {
			actions.moveClipById(clipId, deltaSeconds)
			return
		}
		if (state.kind === 'move') {
			return
		}

		actions.resizeClipById(clipId, state.kind === 'resize-start' ? 'start' : 'end', deltaSeconds)
	}

	return (
		<button
			type="button"
			className={`ve-clip${selected ? ' is-selected' : ''}`}
			data-tool={activeTool}
			style={{ left: `${left}px`, width: `${width}px`, borderLeft: `4px solid ${color}` }}
			onClick={(event) => {
				if (activeTool === 'split') {
					splitAtPointer(event.clientX, event.currentTarget)
					return
				}

				if (activeTool !== 'hand') {
					actions.selectEntity(clipId)
				}
			}}
			onPointerDown={(event) => {
				if ((event.target as HTMLElement | null)?.closest('.ve-clip__resize-handle')) {
					return
				}
				if (activeTool !== 'select') {
					return
				}

				event.currentTarget.setPointerCapture?.(event.pointerId)
				dragState.current = { kind: 'move', startX: event.clientX }
			}}
			onPointerUp={(event) => {
				finishPointerDrag(event.clientX)
			}}
		>
			<span
				className="ve-clip__resize-handle ve-clip__resize-handle--start"
				aria-label="Resize clip start"
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation()
					event.currentTarget.setPointerCapture?.(event.pointerId)
					dragState.current = { kind: 'resize-start', startX: event.clientX }
				}}
				onPointerUp={(event) => {
					event.stopPropagation()
					finishPointerDrag(event.clientX)
				}}
			/>
			<span>{name}</span>
			<small>
				{name} · {formatSeconds(start)} / {formatSeconds(duration)} · opacity {formatPercent(opacity)}
			</small>
			<span
				className="ve-clip__resize-handle ve-clip__resize-handle--end"
				aria-label="Resize clip end"
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation()
					event.currentTarget.setPointerCapture?.(event.pointerId)
					dragState.current = { kind: 'resize-end', startX: event.clientX }
				}}
				onPointerUp={(event) => {
					event.stopPropagation()
					finishPointerDrag(event.clientX)
				}}
			/>
		</button>
	)
})
