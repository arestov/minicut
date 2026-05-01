import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatPercent, formatSeconds } from './format'

interface ClipItemProps {
	projectId: string
	clipId: string
	selected: boolean
}

export const ClipItem = observer(({ projectId, clipId, selected }: ClipItemProps) => {
	const { projects$, actions } = useVideoEditor()
	const clip$ = projects$.projects[projectId].entities[clipId]
	const name = String(clip$.attrs.name.get())
	const start = Number(clip$.attrs.start.get())
	const duration = Number(clip$.attrs.duration.get())
	const opacity = Number(clip$.attrs.opacity.get())

	return (
		<button
			type="button"
			className={`ve-clip${selected ? ' is-selected' : ''}`}
			onClick={() => actions.selectEntity(clipId)}
		>
			<span>{name}</span>
			<small>
				{name} · {formatSeconds(start)} / {formatSeconds(duration)} · opacity {formatPercent(opacity)}
			</small>
		</button>
	)
})
