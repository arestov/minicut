import { Toolbar } from './Toolbar'
import { ProjectSidebar } from './ProjectSidebar'
import { MediaBin } from './MediaBin'
import { TimelineView } from './TimelineView'
import { Inspector } from './Inspector'
import { PreviewPanel } from './PreviewPanel'
import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useVideoEditor } from '../app/VideoEditorContext'

const PlaybackLoop = observer(() => {
	const { session$, actions } = useVideoEditor()
	const isPlaying = session$.isPlaying.get()

	useEffect(() => {
		if (!isPlaying) {
			return
		}

		let lastTime = performance.now()
		let frameId = 0
		const tick = (time: number) => {
			const deltaSeconds = Math.min((time - lastTime) / 1000, 0.25)
			lastTime = time
			actions.tickPlayback(deltaSeconds)
			frameId = requestAnimationFrame(tick)
		}

		frameId = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frameId)
	}, [actions, isPlaying])

	return null
})

export const VideoEditorApp = () => (
	<div className="ve-shell">
		<PlaybackLoop />
		<Toolbar />
		<div className="ve-layout">
			<ProjectSidebar />
			<main className="ve-main">
				<div className="ve-main__top">
					<MediaBin />
					<PreviewPanel />
					<Inspector />
				</div>
				<TimelineView />
			</main>
		</div>
	</div>
)
