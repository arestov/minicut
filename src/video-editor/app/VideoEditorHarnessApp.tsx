import { useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { VideoEditorApp } from '../ui/VideoEditorApp'
import { resolveRoomUrlState, type RoomUrlResolution } from './roomUrlState'
import '../ui/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
}

const LAST_ROOM_STORAGE_KEY = 'minicut:last-room-id'

const resolveBrowserRoom = (): RoomUrlResolution | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const resolved = resolveRoomUrlState({
		hash: window.location.hash,
		lastRoomId: window.localStorage.getItem(LAST_ROOM_STORAGE_KEY),
	})
	window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, resolved.roomId)
	if (resolved.shouldReplace) {
		window.history.replaceState(window.history.state, '', resolved.canonicalHash)
	}

	return resolved
}

export const VideoEditorHarnessApp = ({
	harness: providedHarness,
}: VideoEditorHarnessAppProps) => {
	const resolvedRoom = useMemo(() => resolveBrowserRoom(), [])
	const ownedHarness = useMemo(() => {
		if (providedHarness) {
			return providedHarness
		}

		if (!resolvedRoom || typeof window === 'undefined') {
			return createVideoEditorHarness()
		}

		return createVideoEditorHarness(undefined, {
			authorityOptions: {
				p2p: {
					roomId: resolvedRoom.roomId,
					signalUrl: window.location.origin,
				},
			},
		})
	}, [providedHarness, resolvedRoom])

	return (
		<VideoEditorProvider value={ownedHarness}>
			<VideoEditorApp />
		</VideoEditorProvider>
	)
}
