import type { Observable } from '@legendapp/state'
import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
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

const previewWindowRequestIntervalMs = 200

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
	const isPlaying = session$.isPlaying.get()
	const lastWindowRequestAtRef = useRef(new Map<string, number>())
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
		const now = performance.now()
		for (const clip of frame.renderedClips) {
			if (!clip.resourceId || (clip.resourceKind !== 'video' && clip.resourceKind !== 'audio')) {
				continue
			}

			const lastRequestedAt = lastWindowRequestAtRef.current.get(clip.resourceId) ?? 0
			if (isPlaying && now - lastRequestedAt < previewWindowRequestIntervalMs) {
				continue
			}

			lastWindowRequestAtRef.current.set(clip.resourceId, now)
			requestResourcePlayheadWindow(clip.resourceId, Math.max(0, frame.cursor - clip.start + clip.inPoint))
		}
	}, [frame, isPlaying, requestResourcePlayheadWindow])

	return (
		<RendererStage
			structure={structure$.get()}
			frame={resolvedFrame}
			isPlaying={isPlaying}
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

const PreviewCursorReadout = observer(({ frame$ }: { frame$: Observable<PreviewFrame> }) => {
	const cursor = frame$.cursor.get()

	return (
		<>
			<span className="ve-sr-only">Cursor at {formatSeconds(cursor)}</span>
			<span>{formatSeconds(cursor)}</span>
		</>
	)
})

const PreviewActiveClipsReadout = observer(({ frame$ }: { frame$: Observable<PreviewFrame> }) => {
	const activeClipNames = frame$.activeClipNames.get()

	return (
		<span>{activeClipNames.length > 0 ? activeClipNames.join(', ') : 'No active clips'}</span>
	)
})

const PreviewTransport = ({
	frame$,
	session$,
	onTogglePlayback,
}: {
	frame$: Observable<PreviewFrame>
	session$: Observable<EditorSessionState>
	onTogglePlayback: () => void
}) => {
	return (
		<div className="ve-preview-transport" aria-label="Preview transport status">
			<div>
				<Timer size={15} aria-hidden="true" />
				<PreviewCursorReadout frame$={frame$} />
			</div>
			<div>
				<Gauge size={15} aria-hidden="true" />
				<span>Draft preview</span>
			</div>
			<div className="ve-preview-transport__active">
				<PreviewActiveClipsReadout frame$={frame$} />
			</div>
			<div className="ve-preview-transport__playback">
				<PreviewPlaybackButton
					session$={session$}
					onTogglePlayback={onTogglePlayback}
				/>
			</div>
		</div>
	)
}

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
