import { useEffect, useMemo } from 'react'
import { VideoEditorProvider } from './VideoEditorContext'
import { createVideoEditorHarness, type VideoEditorHarness } from './createVideoEditorHarness'
import { createBrowserHarnessPlatform } from './platform'
import { VideoEditorApp } from '../components/VideoEditorApp'
import { DktEditorRoot } from '../ui/dkt/DktEditorRoot'
import { createDefaultRtcConfig } from '../p2p/PageP2PManager'
import { resolveRoomUrlState, type RoomUrlResolution } from './roomUrlState'
import '../components/styles.css'

interface VideoEditorHarnessAppProps {
	harness?: VideoEditorHarness
	dktBootstrapOptions?: Parameters<NonNullable<VideoEditorHarness['pageRuntime']>['bootstrap']>[0] | null
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
	dktBootstrapOptions,
	harness: providedHarness,
}: VideoEditorHarnessAppProps) => {
	const resolvedDktBootstrapOptions = useMemo(() => {
		if (dktBootstrapOptions !== undefined) {
			return dktBootstrapOptions
		}

		const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2)
		return { sessionKey: `minicut-${randomPart}` }
	}, [dktBootstrapOptions])
	const resolvedRoom = useMemo(() => resolveBrowserRoom(), [])
	const signalUrl = useMemo(() => resolveSignalUrl(), [])
	const rtcConfig = useMemo(() => createDefaultRtcConfig(resolveTurnIceServer()), [])
	const mediaTransferOptions = useMemo(() => resolveMediaTransferOptions(), [])
	const ownedHarness = useMemo(() => {
		if (providedHarness) {
			return providedHarness
		}

		if (!resolvedRoom || !signalUrl) {
			return createVideoEditorHarness(undefined, {
				platform: createBrowserHarnessPlatform(),
			})
		}

		const authorityOptions = {
			p2p: {
				roomId: resolvedRoom.roomId,
				signalUrl,
				rtcConfig,
				onSessionLost(reason: string) {
					console.warn('[minicut:p2p] app observed session loss', {
						roomId: resolvedRoom.roomId,
						reason,
					})
				},
				onError(error: unknown) {
					console.warn('[minicut:p2p] app observed p2p error', {
						roomId: resolvedRoom.roomId,
						error,
					})
				},
			},
		}

		return createVideoEditorHarness(undefined, {
			mediaTransferOptions,
			platform: createBrowserHarnessPlatform({ authorityOptions }),
		})
	}, [mediaTransferOptions, providedHarness, resolvedRoom, rtcConfig, signalUrl])

	useEffect(() => {
		if (typeof window === 'undefined') {
			return
		}

		const shouldInstallDebugBridge = import.meta.env.DEV || (window as typeof window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ === true
		let cancelled = false
		let cleanup: (() => void) | undefined

		if (!shouldInstallDebugBridge) {
			return
		}

		void import('./testing/installMiniCutDebugBridge.testing').then(({ installMiniCutDebugBridgeTesting }) => {
			if (cancelled) {
				return
			}
			cleanup = installMiniCutDebugBridgeTesting(ownedHarness)
		}).catch((error) => {
			console.warn('[minicut] debug bridge installation failed', error)
		})

		return () => {
			cancelled = true
			cleanup?.()
		}
	}, [ownedHarness])

	return (
		<VideoEditorProvider value={ownedHarness}>
			<DktEditorRoot runtime={ownedHarness.pageRuntime} bootstrapOptions={resolvedDktBootstrapOptions}>
				<VideoEditorApp />
			</DktEditorRoot>
		</VideoEditorProvider>
	)
}
