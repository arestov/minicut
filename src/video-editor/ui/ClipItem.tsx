import { observer } from '@legendapp/state/react'
import { useRef } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatPercent, formatSeconds } from './format'

interface ClipItemProps {
	projectId: string
	clipId: string
	selected: boolean
	timelineZoom: number
}

export const ClipItem = observer(({ projectId, clipId, selected, timelineZoom }: ClipItemProps) => {
	const { projects$, actions } = useVideoEditor()
	const dragStartX = useRef<number | null>(null)
	const clip$ = projects$.entitiesById[clipId]
	const name = String(clip$.attrs.name.get())
	const start = Number(clip$.attrs.start.get())
	const duration = Number(clip$.attrs.duration.get())
	const opacity = Number(clip$.attrs.opacity.value.get())
	const width = Math.max(160, duration * timelineZoom)

	return (
		<button
			type="button"
			className={`ve-clip${selected ? ' is-selected' : ''}`}
			style={{ width: `${width}px` }}
			onClick={() => actions.selectEntity(clipId)}
			onPointerDown={(event) => {
				dragStartX.current = event.clientX
			}}
			onPointerUp={(event) => {
				const startX = dragStartX.current
				dragStartX.current = null
				if (startX == null) {
					return
				}

				const deltaSeconds = Math.round(((event.clientX - startX) / timelineZoom) * 2) / 2
				if (deltaSeconds !== 0) {
					actions.selectEntity(clipId)
					actions.moveClipById(clipId, deltaSeconds)
				}
			}}
		>
			<span>{name}</span>
			<small>
				{name} · {formatSeconds(start)} / {formatSeconds(duration)} · opacity {formatPercent(opacity)}
			</small>
		</button>
	)
})
