import { observer } from '@legendapp/state/react'
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
	const clip$ = projects$.projects[projectId].entities[clipId]
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
		>
			<span>{name}</span>
			<small>
				{name} · {formatSeconds(start)} / {formatSeconds(duration)} · opacity {formatPercent(opacity)}
			</small>
		</button>
	)
})
