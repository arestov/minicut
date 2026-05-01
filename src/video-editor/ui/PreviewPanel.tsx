import { observer } from '@legendapp/state/react'
import { Gauge, Pause, Play, Timer } from 'lucide-react'
import { useVideoEditor } from '../app/VideoEditorContext'
import { formatSeconds } from './format'
import { IconButton } from './ControlPrimitives'
import { RendererStage } from './RendererStage'

const getActiveClipNames = (
	projects$: ReturnType<typeof useVideoEditor>['projects$'],
	projectId: string | null,
	cursor: number,
): string[] => {
	if (!projectId) {
		return []
	}

	const project$ = projects$.projects[projectId]
	const rootEntityId = project$.rootEntityId.get()
	const timelineId = projects$.entitiesById[rootEntityId].rels.activeTimeline.get()
	if (typeof timelineId !== 'string') {
		return []
	}

	const trackIds = projects$.entitiesById[timelineId].rels.tracks.get()
	if (!Array.isArray(trackIds)) {
		return []
	}

	const activeNames: string[] = []
	for (const trackId of trackIds) {
		const clipIds = projects$.entitiesById[trackId].rels.clips.get()
		if (!Array.isArray(clipIds)) {
			continue
		}

		for (const clipId of clipIds) {
			const clip$ = projects$.entitiesById[clipId]
			const start = Number(clip$.attrs.start.get())
			const duration = Number(clip$.attrs.duration.get())
			if (cursor >= start && cursor < start + duration) {
				activeNames.push(String(clip$.attrs.name.get()))
			}
		}
	}

	return activeNames
}

export const PreviewPanel = observer(() => {
	const { projects$, session$, actions } = useVideoEditor()
	const cursor = session$.cursor.get()
	const isPlaying = session$.isPlaying.get()
	const activeProjectId = session$.activeProjectId.get() ?? projects$.activeProjectId.get()
	const activeClipNames = getActiveClipNames(projects$, activeProjectId, cursor)

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
			</div>
			<RendererStage />
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
