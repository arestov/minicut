import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	createPreviewFrame$,
	createPreviewStructure$,
	type RenderedClip,
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
	resolveResourceUrl,
	requestResourcePlayheadWindow,
	noteResourcePreviewError,
}: {
	frame$: Observable<PreviewFrame>
	structure$: Observable<PreviewStructure>
	session$: Observable<EditorSessionState>
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string
	requestResourcePlayheadWindow: (resourceId: string, time: number) => void
	noteResourcePreviewError: (resourceId: string) => void
}) => {
	const frame = frame$.get()
	const resolvedClip = (clip: RenderedClip): RenderedClip => ({
		...clip,
		resourceUrl: clip.resourceId ? resolveResourceUrl(clip.resourceId, clip.resourceUrl) : clip.resourceUrl,
	})
	const resolvedFrame: PreviewFrame = {
		...frame,
		renderedClips: frame.renderedClips.map(resolvedClip),
		visualRenderedClips: frame.visualRenderedClips.map(resolvedClip),
		audioRenderedClips: frame.audioRenderedClips.map(resolvedClip),
	}

	useEffect(() => {
		for (const clip of frame.renderedClips) {
			if (!clip.resourceId || (clip.resourceKind !== 'video' && clip.resourceKind !== 'audio')) {
				continue
			}

			requestResourcePlayheadWindow(clip.resourceId, Math.max(0, frame.cursor - clip.start + clip.inPoint))
		}
	}, [frame, requestResourcePlayheadWindow])

	return (
		<RendererStage
			structure={structure$.get()}
			frame={resolvedFrame}
			isPlaying={session$.isPlaying.get()}
			onClipMediaError={(resourceId) => noteResourcePreviewError(resourceId)}
		/>
	)
})

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
	const { projects$, session$, actions, resolveResourceUrl, requestResourcePlayheadWindow, noteResourcePreviewError } = useVideoEditor()
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
			<PreviewStage
				frame$={previewFrame$}
				structure$={previewStructure$}
				session$={session$}
				resolveResourceUrl={resolveResourceUrl}
				requestResourcePlayheadWindow={requestResourcePlayheadWindow}
				noteResourcePreviewError={noteResourcePreviewError}
			/>
			<PreviewTransport
				frame$={previewFrame$}
				session$={session$}
				onTogglePlayback={() => actions.togglePlayback()}
			/>
		</section>
	)
}
