import { useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { VideoEditorApp } from '../ui/VideoEditorApp'
import { resolveRoomUrlState } from './roomUrlState'
import '../ui/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
}

const LAST_ROOM_STORAGE_KEY = 'minicut:last-room-id'

const resolveBrowserRoom = (): void => {
	if (typeof window === 'undefined') {
		return
	}

	const resolved = resolveRoomUrlState({
		hash: window.location.hash,
		lastRoomId: window.localStorage.getItem(LAST_ROOM_STORAGE_KEY),
	})
	window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, resolved.roomId)
	if (resolved.shouldReplace) {
		window.history.replaceState(window.history.state, '', resolved.canonicalHash)
	}
}

export const VideoEditorHarnessApp = ({
	harness: providedHarness,
}: VideoEditorHarnessAppProps) => {
	resolveBrowserRoom()
	const ownedHarness = useMemo(() => providedHarness ?? createVideoEditorHarness(), [providedHarness])

	return (
		<VideoEditorProvider value={ownedHarness}>
			<VideoEditorApp />
		</VideoEditorProvider>
	)
}
