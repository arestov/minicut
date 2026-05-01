import { observer } from '@legendapp/state/react'
import type { Entity } from '../domain/types'
import { getClipLabel } from '../domain/selectors'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatPercent } from './format'

interface ClipItemProps {
	clip: Entity
	selected: boolean
}

export const ClipItem = observer(({ clip, selected }: ClipItemProps) => {
	const { actions } = useVideoEditor()
	const opacity = Number(clip.attrs.opacity)

	return (
		<button
			type="button"
			className={`ve-clip${selected ? ' is-selected' : ''}`}
			onClick={() => actions.selectEntity(clip.id)}
		>
			<span>{String(clip.attrs.name)}</span>
			<small>
				{getClipLabel(clip)} · opacity {formatPercent(opacity)}
			</small>
		</button>
	)
})
