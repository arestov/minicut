import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { createPreviewScene$, type PreviewScene } from '../legend/derivedTimeline'
import { formatSeconds } from './format'
import { IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

const PreviewStage = observer(({ scene$ }: { scene$: Observable<PreviewScene> }) => (
	<RendererStage scene={scene$.get()} />
))

const PreviewPlaybackButton = observer(({
	scene$,
	onTogglePlayback,
}: {
	scene$: Observable<PreviewScene>
	onTogglePlayback: () => void
}) => {
	const isPlaying = scene$.isPlaying.get()

	return (
		<IconButton
			type="button"
			icon={isPlaying ? Pause : Play}
			label={isPlaying ? 'Pause' : 'Play'}
			variant="default"
			onClick={onTogglePlayback}
		>
			{isPlaying ? 'Pause' : 'Play'}
		</IconButton>
	)
})

const PreviewTransport = observer(({ scene$ }: { scene$: Observable<PreviewScene> }) => {
	const cursor = scene$.cursor.get()
	const activeClipNames = scene$.activeClipNames.get()

	return (
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
	)
})

export const PreviewPanel = () => {
	const { projects$, session$, actions } = useVideoEditor()
	const previewScene$ = useMemo(
		() => createPreviewScene$(projects$, session$),
		[projects$, session$],
	)

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
			</div>
			<PreviewStage scene$={previewScene$} />
			<div className="ve-preview-panel__playback">
				<PreviewPlaybackButton
					scene$={previewScene$}
					onTogglePlayback={() => actions.togglePlayback()}
				/>
			</div>
			<PreviewTransport scene$={previewScene$} />
		</section>
	)
}
