import { useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { VideoEditorApp } from '../ui/VideoEditorApp'
import '../ui/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
}

export const VideoEditorHarnessApp = ({
	harness: providedHarness,
}: VideoEditorHarnessAppProps) => {
	const ownedHarness = useMemo(() => providedHarness ?? createVideoEditorHarness(), [providedHarness])

	return (
		<VideoEditorProvider value={ownedHarness}>
			<VideoEditorApp />
		</VideoEditorProvider>
	)
}
