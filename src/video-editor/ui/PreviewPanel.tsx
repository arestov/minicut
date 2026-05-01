import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { createPreviewScene$ } from '../legend/derivedTimeline'
import { formatSeconds } from './format'
import { IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

export const PreviewPanel = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const previewScene$ = useMemo(
		() => createPreviewScene$(projects$, session$),
		[projects$, session$],
	)
	const scene = previewScene$.get()
	const { cursor, isPlaying, activeClipNames } = scene

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
			</div>
			<RendererStage scene={scene} />
			<div className="ve-preview-panel__playback">
				<IconButton
					type="button"
					icon={isPlaying ? Pause : Play}
					label={isPlaying ? 'Pause' : 'Play'}
					variant="default"
					onClick={() => actions.togglePlayback()}
				>
					{isPlaying ? 'Pause' : 'Play'}
				</IconButton>
			</div>
			<div className="ve-preview-transport" aria-label="Preview transport status">
				<div>
					<Timer size={15} aria-hidden="true" />
					<span className="ve-sr-only">Cursor at {formatSeconds(cursor)}</span>
					<span>{formatSeconds(cursor)}</span>
				</div>
				<div>
					<Gauge size={15} aria-hidden="true" />
					<span>Draft preview</span>
				</div>
				<div className="ve-preview-transport__active">
					<span>{activeClipNames.length > 0 ? activeClipNames.join(', ') : 'No active clips'}</span>
				</div>
			</div>
		</section>
	)
})
