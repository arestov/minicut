import { useEffect, useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { VideoEditorApp } from '../ui/VideoEditorApp'
import { CMD } from '../domain/types'
import { resolveRoomUrlState, type RoomUrlResolution } from './roomUrlState'
import '../ui/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
}

const LAST_ROOM_STORAGE_KEY = 'minicut:last-room-id'

const resolveSignalUrl = (): string | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const raw = new URLSearchParams(window.location.search).get('signalUrl')
	if (!raw) {
		return null
	}

	try {
		return new URL(raw, window.location.origin).toString().replace(/\/$/, '')
	} catch {
		return null
	}
}

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
	const signalUrl = useMemo(() => resolveSignalUrl(), [])
	const ownedHarness = useMemo(() => {
		if (providedHarness) {
			return providedHarness
		}

		if (!resolvedRoom || !signalUrl) {
			return createVideoEditorHarness()
		}

		return createVideoEditorHarness(undefined, {
			authorityOptions: {
				p2p: {
					roomId: resolvedRoom.roomId,
					signalUrl,
				},
			},
		})
	}, [providedHarness, resolvedRoom, signalUrl])

	useEffect(() => {
		if (typeof window === 'undefined' || !import.meta.env.DEV) {
			return
		}

		const debug = {
			getProjectCount: () => Object.keys(ownedHarness.projects$.get().projects).length,
			getRole: () => {
				const worker = ownedHarness.worker as { role?: string }
				return typeof worker.role === 'string' ? worker.role : null
			},
			getPeerId: () => {
				const worker = ownedHarness.worker as { peerId?: string }
				return typeof worker.peerId === 'string' ? worker.peerId : null
			},
			createProject: () => {
				ownedHarness.actions.createProject()
			},
			dispatchCreateProject: async () => {
				let timeoutId = 0
				const timeoutPromise = new Promise<never>((_, reject) => {
					timeoutId = window.setTimeout(() => {
						reject(new Error('dispatchCreateProject timed out'))
					}, 5_000)
				})
				try {
					await Promise.race([
						Promise.resolve(ownedHarness.worker.dispatch({ c: CMD.PROJECT_CREATE, p: {} })),
						timeoutPromise,
					])
				} finally {
					window.clearTimeout(timeoutId)
				}
			},
		}

		;(window as typeof window & { __MINICUT_P2P_DEBUG__?: typeof debug }).__MINICUT_P2P_DEBUG__ = debug

		return () => {
			const current = (window as typeof window & { __MINICUT_P2P_DEBUG__?: typeof debug }).__MINICUT_P2P_DEBUG__
			if (current === debug) {
				delete (window as typeof window & { __MINICUT_P2P_DEBUG__?: typeof debug }).__MINICUT_P2P_DEBUG__
			}
		}
	}, [ownedHarness])

	return (
		<VideoEditorProvider value={ownedHarness}>
			<VideoEditorApp />
		</VideoEditorProvider>
	)
}
