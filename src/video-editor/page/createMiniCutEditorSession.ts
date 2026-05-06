import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import { createDefaultRtcConfig } from '../p2p/PageP2PManager'
import { createVideoEditorHarness, type VideoEditorHarness } from '../app/createVideoEditorHarness'
import { createBrowserHarnessPlatform } from '../app/platform'
import { resolveRoomUrlState, type RoomUrlResolution } from '../app/roomUrlState'

const LAST_ROOM_STORAGE_KEY = 'minicut:last-room-id'
const DEFAULT_SESSION_KEY = 'minicut-local'

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
		// Keep automation runs local unless signalUrl is explicitly provided in the URL.
		if (typeof navigator !== 'undefined' && navigator.webdriver === true) {
			return null
		}

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

const createBrowserHarness = (resolvedRoom: RoomUrlResolution | null, signalUrl: string | null): VideoEditorHarness => {
	const mediaTransferOptions = resolveMediaTransferOptions()
	if (!resolvedRoom || !signalUrl) {
		return createVideoEditorHarness(undefined, {
			mediaTransferOptions,
			platform: createBrowserHarnessPlatform(),
		})
	}

	return createVideoEditorHarness(undefined, {
		mediaTransferOptions,
		platform: createBrowserHarnessPlatform({
			authorityOptions: {
				p2p: {
					roomId: resolvedRoom.roomId,
					signalUrl,
					rtcConfig: createDefaultRtcConfig(resolveTurnIceServer()),
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
			},
		}),
	})
}

export interface MiniCutEditorSession {
	harness: VideoEditorHarness
	room: RoomUrlResolution | null
	runtime: PageSyncRuntime | null
	store: PageSyncRuntime['store'] | null
	bootstrap(options?: Parameters<PageSyncRuntime['bootstrap']>[0]): void
	describeNode(nodeId: string): unknown
	dispatchAction(actionName: string, payload?: unknown, scope?: ReactSyncScopeHandle | null): void
	dumpGraph(): unknown
	messages(): readonly unknown[]
	snapshot(): ReturnType<PageSyncRuntime['getSnapshot']> | null
	destroy(): void
}

export const createMiniCutEditorSession = (): MiniCutEditorSession => {
	const room = resolveBrowserRoom()
	const signalUrl = resolveSignalUrl()
	const harness = createBrowserHarness(room, signalUrl)
	const runtime = harness.pageRuntime
	const sessionKey = signalUrl && room ? room.roomId : DEFAULT_SESSION_KEY

	return {
		harness,
		room,
		runtime,
		store: runtime?.store ?? null,
		bootstrap(options) {
			runtime?.bootstrap({ sessionKey, ...options })
		},
		describeNode(nodeId) {
			return runtime?.debugDescribeNode(nodeId) ?? null
		},
		dispatchAction(actionName, payload, scope) {
			runtime?.dispatchAction(actionName, payload, scope)
		},
		dumpGraph() {
			return runtime?.debugDumpGraph() ?? null
		},
		messages() {
			return runtime?.debugMessages() ?? []
		},
		snapshot() {
			return runtime?.getSnapshot() ?? null
		},
		destroy() {
			harness.destroy()
		},
	}
}
