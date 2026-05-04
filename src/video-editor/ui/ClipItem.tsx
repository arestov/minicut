import { observer } from '@legendapp/state/react'
import { useRef, useState } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { clipAttrs$, clipRels$, effectAttrs$ } from '../legend/observableSelectors'
import { formatPercent, formatSeconds } from './format'

type ClipPointerDragState =
	| { kind: 'move'; startX: number }
	| { kind: 'resize-start' | 'resize-end'; startX: number; lastClientX: number }

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
	const [dragPreviewDeltaPx, setDragPreviewDeltaPx] = useState(0)
	const clip$ = clipAttrs$(projects$, clipId)
	const clipRels = clipRels$(projects$, clipId)
	const name = String(clip$.name.get())
	const start = Number(clip$.start.get())
	const duration = Number(clip$.duration.get())
	const opacity = Number(clip$.opacity.value.get())
	const color = String(clip$.color.get() ?? '#2563eb')
	const effectIds = clipRels.effects.get()
	const hasActiveColorGrade = (Array.isArray(effectIds) ? effectIds : []).some((effectId) => {
		const effect = projects$.entitiesById[effectId]
		if (!effect || effect.type.get() !== 'effect') {
			return false
		}

		const effectAttrs = effectAttrs$(projects$, effectId)
		return String(effectAttrs.kind.get()) === 'color-correction' && effectAttrs.enabled.get() !== false
	})
	const width = Math.max(36, duration * timelineZoom)
	const left = Math.max(0, start * timelineZoom + dragPreviewDeltaPx)
	const splitAtPointer = (clientX: number, element: HTMLElement): void => {
		const rect = element.getBoundingClientRect()
		const localTime = Math.max(0, (clientX - rect.left) / timelineZoom)
		actions.splitClipByIdAt(clipId, start + localTime)
	}
	const applyResizeDelta = (state: Extract<ClipPointerDragState, { kind: 'resize-start' | 'resize-end' }>, clientX: number): void => {
		const deltaSeconds = Math.round(((clientX - state.lastClientX) / timelineZoom) * 100) / 100
		if (deltaSeconds === 0) {
			return
		}

		actions.selectEntity(clipId)
		actions.resizeClipById(clipId, state.kind === 'resize-start' ? 'start' : 'end', deltaSeconds)
		dragState.current = { ...state, lastClientX: clientX }
	}
	const finishPointerDrag = (clientX: number): void => {
		const state = dragState.current
		dragState.current = null
		setDragPreviewDeltaPx(0)
		if (!state) {
			return
		}

		if (state.kind === 'resize-start' || state.kind === 'resize-end') {
			applyResizeDelta(state, clientX)
			return
		}

		const deltaSeconds = Math.round(((clientX - state.startX) / timelineZoom) * 100) / 100
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
			onPointerMove={(event) => {
				const state = dragState.current
				if (!state || (event.buttons & 1) === 0) {
					return
				}

				if (state.kind === 'resize-start' || state.kind === 'resize-end') {
					applyResizeDelta(state, event.clientX)
					return
				}
				if (activeTool !== 'select') {
					return
				}

				setDragPreviewDeltaPx(Math.max(-start * timelineZoom, event.clientX - state.startX))
			}}
			onPointerUp={(event) => {
				finishPointerDrag(event.clientX)
			}}
			onPointerCancel={() => {
				dragState.current = null
				setDragPreviewDeltaPx(0)
			}}
		>
			<span
				className="ve-clip__resize-handle ve-clip__resize-handle--start"
				aria-label="Resize clip start"
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation()
					event.currentTarget.setPointerCapture?.(event.pointerId)
					actions.selectEntity(clipId)
					dragState.current = { kind: 'resize-start', startX: event.clientX, lastClientX: event.clientX }
				}}
				onPointerUp={(event) => {
					event.stopPropagation()
					finishPointerDrag(event.clientX)
				}}
			/>
			<div className="ve-clip__title">
				<span>{name}</span>
				{hasActiveColorGrade ? <span className="ve-clip__badge" aria-label="Color grade enabled">Grade</span> : null}
			</div>
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
					actions.selectEntity(clipId)
					dragState.current = { kind: 'resize-end', startX: event.clientX, lastClientX: event.clientX }
				}}
				onPointerUp={(event) => {
					event.stopPropagation()
					finishPointerDrag(event.clientX)
				}}
			/>
		</button>
	)
})
