import { useEffect, useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { VideoEditorApp } from '../ui/VideoEditorApp'
import { CMD } from '../domain/types'
import { createDefaultRtcConfig } from '../p2p/PageP2PManager'
import { resolveRoomUrlState, type RoomUrlResolution } from './roomUrlState'
import '../ui/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
}

const LAST_ROOM_STORAGE_KEY = 'minicut:last-room-id'

const normalizeList = (raw: string | null | undefined): string[] =>
	String(raw ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value.length > 0)

const resolveSignalUrl = (): string | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const raw = new URLSearchParams(window.location.search).get('signalUrl')
	if (!raw) {
		const envSignalUrl = (import.meta.env as Record<string, unknown>).VITE_MINICUT_SIGNAL_URL
		if (typeof envSignalUrl !== 'string' || envSignalUrl.length === 0) {
			return null
		}

		try {
			return new URL(envSignalUrl, window.location.origin).toString().replace(/\/$/, '')
		} catch {
			return null
		}
	}

	try {
		return new URL(raw, window.location.origin).toString().replace(/\/$/, '')
	} catch {
		return null
	}
}

const resolveTurnIceServer = (): RTCIceServer | null => {
	if (typeof window === 'undefined') {
		return null
	}

	const params = new URLSearchParams(window.location.search)
	const env = import.meta.env as Record<string, unknown>
	const queryUrls = params.getAll('turnUrl').flatMap((value) => normalizeList(value))
	const envUrls = normalizeList(typeof env.VITE_MINICUT_TURN_URLS === 'string' ? env.VITE_MINICUT_TURN_URLS : undefined)
	const urls = queryUrls.length > 0 ? queryUrls : envUrls
	const username = params.get('turnUsername')
		?? (typeof env.VITE_MINICUT_TURN_USERNAME === 'string' ? env.VITE_MINICUT_TURN_USERNAME : null)
	const credential = params.get('turnCredential')
		?? (typeof env.VITE_MINICUT_TURN_CREDENTIAL === 'string' ? env.VITE_MINICUT_TURN_CREDENTIAL : null)

	if (urls.length === 0 || !username || !credential) {
		return null
	}

	return {
		urls: urls.length === 1 ? urls[0] : urls,
		username,
		credential,
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

const resolveMediaTransferOptions = (): {
	chunkSize?: number
	chunkSendDelayMs?: number
	headBytes?: number
	tailBytes?: number
	playheadWindowSeconds?: number
} => {
	if (typeof window === 'undefined') {
		return {}
	}

	const params = new URLSearchParams(window.location.search)
	const getNumber = (key: string): number | undefined => {
		const raw = params.get(key)
		if (!raw) {
			return undefined
		}
		const parsed = Number(raw)
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
	}

	return {
		chunkSize: getNumber('transferChunkSize'),
		chunkSendDelayMs: getNumber('transferChunkDelayMs'),
		headBytes: getNumber('transferHeadBytes'),
		tailBytes: getNumber('transferTailBytes'),
		playheadWindowSeconds: getNumber('transferPlayheadWindowSeconds'),
	}
}

export const VideoEditorHarnessApp = ({
	harness: providedHarness,
}: VideoEditorHarnessAppProps) => {
	const resolvedRoom = useMemo(() => resolveBrowserRoom(), [])
	const signalUrl = useMemo(() => resolveSignalUrl(), [])
	const rtcConfig = useMemo(() => createDefaultRtcConfig(resolveTurnIceServer()), [])
	const mediaTransferOptions = useMemo(() => resolveMediaTransferOptions(), [])
	const ownedHarness = useMemo(() => {
		if (providedHarness) {
			return providedHarness
		}

		if (!resolvedRoom || !signalUrl) {
			return createVideoEditorHarness()
		}

		return createVideoEditorHarness(undefined, {
			mediaTransferOptions,
			authorityOptions: {
				p2p: {
					roomId: resolvedRoom.roomId,
					signalUrl,
						rtcConfig,
				},
			},
		})
	}, [mediaTransferOptions, providedHarness, resolvedRoom, rtcConfig, signalUrl])

	useEffect(() => {
		if (typeof window === 'undefined' || !import.meta.env.DEV) {
			return
		}

		const debug = {
			getProjectCount: () => Object.keys(ownedHarness.projects$.get().projects).length,
			getResourceTransfers: () => Object.values(ownedHarness.resourceTransfers$.get()).map((transfer) => ({
				resourceId: transfer.resourceId,
				name: transfer.name,
				ownerPeerId: transfer.ownerPeerId,
				status: transfer.status,
				progress: transfer.progress,
				totalBytes: transfer.totalBytes,
				loadedBytes: transfer.loadedBytes,
				previewUrl: transfer.previewUrl,
				loadedRanges: transfer.loadedRanges,
				requestedRanges: transfer.requestedRanges,
				requestedHistory: transfer.requestedHistory,
				requestEvents: transfer.requestEvents,
				mode: transfer.mode,
				availability: transfer.availability,
				lastError: transfer.lastError,
			})),
			getProjectTitles: () => {
				const registry = ownedHarness.projects$.get()
				return Object.values(registry.projects)
					.map((project) => registry.entitiesById[project.rootEntityId]?.attrs?.title)
					.filter((title): title is string => typeof title === 'string')
					.sort((left, right) => left.localeCompare(right))
			},
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
			setCursor: (cursor: number) => {
				ownedHarness.actions.setCursor(cursor)
			},
			dispatchCreateProject: async (title?: string) => {
				let timeoutId = 0
				const timeoutPromise = new Promise<never>((_, reject) => {
					timeoutId = window.setTimeout(() => {
						reject(new Error('dispatchCreateProject timed out'))
					}, 5_000)
				})
				try {
					await Promise.race([
						Promise.resolve(ownedHarness.worker.dispatch({ c: CMD.PROJECT_CREATE, p: { title } })),
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
