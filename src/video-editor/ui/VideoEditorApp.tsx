import { Toolbar } from './Toolbar'
import { MediaBin } from './MediaBin'
import { TimelineView } from './TimelineView'
import { Inspector } from './Inspector'
import { PreviewPanel } from './PreviewPanel'
import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'

const playbackUiFrameMs = 1000 / 30

const PlaybackLoop = observer(() => {
	const { session$, actions } = useVideoEditor()
	const isPlaying = session$.isPlaying.get()

	useEffect(() => {
		if (!isPlaying) {
			return
		}

		let lastTime = performance.now()
		let accumulatedMs = 0
		let frameId = 0
		const tick = (time: number) => {
			const elapsedMs = time - lastTime
			lastTime = time
			accumulatedMs += elapsedMs
			if (accumulatedMs >= playbackUiFrameMs) {
				const deltaSeconds = Math.min(accumulatedMs / 1000, 0.25)
				accumulatedMs = 0
				actions.tickPlayback(deltaSeconds)
			}
			frameId = requestAnimationFrame(tick)
		}

		frameId = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frameId)
	}, [actions, isPlaying])

	return null
})

export const VideoEditorApp = observer(() => {
	const { session$ } = useVideoEditor()
	const showColorScopes = session$.activeInspectorTab.get() === 'color'

	return (
		<div className="ve-shell">
			<PlaybackLoop />
			<Toolbar />
			<main className="ve-main">
				<div className={`ve-main__top${showColorScopes ? ' ve-main__top--scopes' : ''}`}>
					<MediaBin />
					<PreviewPanel />
					<Inspector />
				</div>
				<TimelineView />
			</main>
		</div>
	)
})
