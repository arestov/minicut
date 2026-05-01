import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	createPreviewStructure$,
	renderPreviewStructureAtCursor,
	type PreviewStructure,
} from '../legend/derivedTimeline'
import type { EditorSessionState } from '../domain/types'
import { formatSeconds } from './format'
import { IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

const PreviewStage = observer(({
	structure$,
	session$,
}: {
	structure$: Observable<PreviewStructure>
	session$: Observable<EditorSessionState>
}) => (
	<RendererStage
		structure={structure$.get()}
		cursor={session$.cursor.get()}
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
	structure$,
	session$,
}: {
	structure$: Observable<PreviewStructure>
	session$: Observable<EditorSessionState>
}) => {
	const cursor = session$.cursor.get()
	const activeClipNames = renderPreviewStructureAtCursor(
		structure$.get(),
		cursor,
	).map((clip) => clip.name)

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
	const previewStructure$ = useMemo(
		() => createPreviewStructure$(projects$, session$),
		[projects$, session$],
	)

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
			</div>
			<PreviewStage structure$={previewStructure$} session$={session$} />
			<div className="ve-preview-panel__playback">
				<PreviewPlaybackButton
					session$={session$}
					onTogglePlayback={() => actions.togglePlayback()}
				/>
			</div>
			<PreviewTransport structure$={previewStructure$} session$={session$} />
		</section>
	)
}
