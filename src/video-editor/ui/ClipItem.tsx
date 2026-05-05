import { useRef, useState } from 'react'
import type { AnimatedScalar } from '../domain/types'
import {
	useEditorActions,
	useEditorAttrs,
	useEditorComp,
	type ClipTimelineEditBounds,
} from '../render-sync'
import type { EditorScope } from '../render-sync/EditorScope'
import { formatPercent, formatSeconds } from './format'

const MIN_CLIP_DURATION = 0.5

const clamp = (value: number, min: number, max: number): number => {
	const safeMax = Math.max(min, max)
	return Math.min(safeMax, Math.max(min, value))
}

type ClipPointerDragState =
	| { kind: 'move'; startX: number }
	| { kind: 'resize-start' | 'resize-end'; startX: number; lastClientX: number }

interface ClipItemProps {
	clipScope: EditorScope
	timelineZoom: number
	activeTool: 'select' | 'trim' | 'split' | 'hand'
}

interface ClipRenderAttrs {
	name?: unknown
	start?: unknown
	duration?: unknown
	in?: unknown
	opacity?: AnimatedScalar
	color?: unknown
}

export const ClipItem = ({ clipScope, timelineZoom, activeTool }: ClipItemProps) => {
	const dragState = useRef<ClipPointerDragState | null>(null)
	const [dragPreviewDeltaPx, setDragPreviewDeltaPx] = useState(0)
	const clipAttrs = useEditorAttrs<ClipRenderAttrs>(['name', 'start', 'duration', 'in', 'opacity', 'color'], clipScope)
	const selectedAttrs = useEditorAttrs<{ selectedEntityId?: unknown }>(['selectedEntityId'])
	const dispatch = useEditorActions(clipScope)
	const editBounds = useEditorComp<ClipTimelineEditBounds | null>('timelineEditBounds', clipScope)
	const hasActiveColorGrade = useEditorComp<boolean>('hasActiveColorGrade', clipScope)
	const clipId = clipScope.nodeId
	const selected = selectedAttrs.selectedEntityId === clipId
	const name = String(clipAttrs.name)
	const start = Number(clipAttrs.start)
	const duration = Number(clipAttrs.duration)
	const inPoint = Number(clipAttrs.in)
	const opacity = Number(clipAttrs.opacity?.value ?? 1)
	const color = String(clipAttrs.color ?? '#2563eb')
	const width = Math.max(36, duration * timelineZoom)
	const left = Math.max(0, start * timelineZoom + dragPreviewDeltaPx)
	const splitAtPointer = (clientX: number, element: HTMLElement): void => {
		const rect = element.getBoundingClientRect()
		const localTime = Math.max(0, (clientX - rect.left) / timelineZoom)
		dispatch('splitAt', { time: start + localTime })
	}
	const getMovePreviewDeltaPx = (deltaPx: number): number => {
		const requestedStart = start + deltaPx / timelineZoom
		const minStart = editBounds?.previousEnd ?? 0
		const maxStart = editBounds?.nextStart === null || editBounds?.nextStart === undefined
			? Number.POSITIVE_INFINITY
			: editBounds.nextStart - duration
		const clampedStart = clamp(requestedStart, minStart, maxStart)

		return (clampedStart - start) * timelineZoom
	}
	const getResizeDeltaSeconds = (edge: 'start' | 'end', deltaSeconds: number): number => {
		const clipEnd = start + duration

		if (edge === 'end') {
			const maxEnd = editBounds?.nextStart ?? Number.POSITIVE_INFINITY
			const nextEnd = clamp(clipEnd + deltaSeconds, start + MIN_CLIP_DURATION, maxEnd)
			return nextEnd - clipEnd
		}

		const minStart = Math.max(editBounds?.previousEnd ?? 0, start - inPoint)
		const nextStart = clamp(start + deltaSeconds, minStart, clipEnd - MIN_CLIP_DURATION)
		return nextStart - start
	}
	const applyResizeDelta = (state: Extract<ClipPointerDragState, { kind: 'resize-start' | 'resize-end' }>, clientX: number): void => {
		const edge = state.kind === 'resize-start' ? 'start' : 'end'
		const requestedDeltaSeconds = Math.round(((clientX - state.lastClientX) / timelineZoom) * 100) / 100
		const deltaSeconds = getResizeDeltaSeconds(edge, requestedDeltaSeconds)
		if (deltaSeconds === 0) {
			return
		}

		dispatch('select')
		dispatch('resize', { edge, delta: deltaSeconds })
		dragState.current = { ...state, lastClientX: state.lastClientX + deltaSeconds * timelineZoom }
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

		dispatch('select')
		if (state.kind === 'move' && activeTool === 'select') {
			dispatch('moveBy', { delta: deltaSeconds })
			return
		}
		if (state.kind === 'move') {
			return
		}

		dispatch('resize', { edge: state.kind === 'resize-start' ? 'start' : 'end', delta: deltaSeconds })
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
					dispatch('select')
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

				setDragPreviewDeltaPx(getMovePreviewDeltaPx(event.clientX - state.startX))
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
					dispatch('select')
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
					dispatch('select')
					dragState.current = { kind: 'resize-end', startX: event.clientX, lastClientX: event.clientX }
				}}
				onPointerUp={(event) => {
					event.stopPropagation()
					finishPointerDrag(event.clientX)
				}}
			/>
		</button>
	)
}
