import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	createPreviewFrame$,
	createPreviewStructure$,
	type PreviewFrame,
	type PreviewStructure,
} from '../legend/derivedTimeline'
import type { EditorSessionState } from '../domain/types'
import { formatSeconds } from './format'
import { IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

const PreviewStage = observer(({
	frame$,
	structure$,
	session$,
}: {
	frame$: Observable<PreviewFrame>
	structure$: Observable<PreviewStructure>
	session$: Observable<EditorSessionState>
}) => (
	<RendererStage
		structure={structure$.get()}
		frame={frame$.get()}
		isPlaying={session$.isPlaying.get()}
	/>
))

const PreviewPlaybackButton = observer(({
	session$,
	onTogglePlayback,
}: {
	session$: Observable<EditorSessionState>
	onTogglePlayback: () => void
}) => {
	const isPlaying = session$.isPlaying.get()

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

const PreviewTransport = observer(({
	frame$,
	session$,
	onTogglePlayback,
}: {
	frame$: Observable<PreviewFrame>
	session$: Observable<EditorSessionState>
	onTogglePlayback: () => void
}) => {
	const frame = frame$.get()

	return (
		<div className="ve-preview-transport" aria-label="Preview transport status">
			<div>
				<Timer size={15} aria-hidden="true" />
				<span className="ve-sr-only">Cursor at {formatSeconds(frame.cursor)}</span>
				<span>{formatSeconds(frame.cursor)}</span>
			</div>
			<div>
				<Gauge size={15} aria-hidden="true" />
				<span>Draft preview</span>
			</div>
			<div className="ve-preview-transport__active">
				<span>{frame.activeClipNames.length > 0 ? frame.activeClipNames.join(', ') : 'No active clips'}</span>
			</div>
			<div className="ve-preview-transport__playback">
				<PreviewPlaybackButton
					session$={session$}
					onTogglePlayback={onTogglePlayback}
				/>
			</div>
		</div>
	)
})

export const PreviewPanel = () => {
	const { projects$, session$, actions } = useVideoEditor()
	const previewStructure$ = useMemo(
		() => createPreviewStructure$(projects$, session$),
		[projects$, session$],
	)
	const previewFrame$ = useMemo(
		() => createPreviewFrame$(previewStructure$, session$),
		[previewStructure$, session$],
	)

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
			</div>
			<PreviewStage frame$={previewFrame$} structure$={previewStructure$} session$={session$} />
			<PreviewTransport
				frame$={previewFrame$}
				session$={session$}
				onTogglePlayback={() => actions.togglePlayback()}
			/>
		</section>
	)
}
