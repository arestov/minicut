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
		if (typeof window === 'undefined' || !import.meta.env.DEV) {
			return
		}

		const getActiveProjectScope = () => {
			const runtime = ownedHarness.pageRuntime
			const rootScope = runtime?.getRootScope()
			if (!runtime || !rootScope) {
				return null
			}

			return runtime.readOne(rootScope, 'activeProject')
		}

		const debug = {
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
				requestedRangesLog: transfer.requestedRangesLog,
				requestEvents: transfer.requestEvents,
				mode: transfer.mode,
				availability: transfer.availability,
				lastError: transfer.lastError,
			})),
			getProjectCount: () => {
				const runtime = ownedHarness.pageRuntime
				const rootScope = runtime?.getRootScope()
				const pioneerScope = rootScope ? runtime?.readOne(rootScope, 'pioneer') : null
				if (!runtime || !pioneerScope) {
					return 0
				}

				return runtime.readMany(pioneerScope, 'project').length
			},
			getProjectTitles: () => {
				const runtime = ownedHarness.pageRuntime
				const rootScope = runtime?.getRootScope()
				const pioneerScope = rootScope ? runtime?.readOne(rootScope, 'pioneer') : null
				if (!runtime || !pioneerScope) {
					return []
				}

				return runtime.readMany(pioneerScope, 'project').map((scope) => {
					const attrs = runtime.readAttrs(scope, ['title']) as {
						title?: unknown
					}
					return typeof attrs.title === 'string' ? attrs.title : 'Project'
				})
			},
			getActiveProjectTracks: () => {
				const runtime = ownedHarness.pageRuntime
				const projectScope = getActiveProjectScope()
				if (!runtime || !projectScope) {
					return []
				}

				return runtime.readMany(projectScope, 'tracks').map((trackScope) => {
					const trackAttrs = runtime.readAttrs(trackScope, ['name', 'kind']) as {
						name?: unknown
						kind?: unknown
					}
					const clipSummaries = runtime.readMany(trackScope, 'clips').map((clipScope) => {
						const clipAttrs = runtime.readAttrs(clipScope, ['name', 'mediaKind', 'sourceClipId']) as {
							name?: unknown
							mediaKind?: unknown
							sourceClipId?: unknown
						}
						return {
							name: typeof clipAttrs.name === 'string' ? clipAttrs.name : 'Clip',
							mediaKind: typeof clipAttrs.mediaKind === 'string' ? clipAttrs.mediaKind : null,
							sourceClipId: typeof clipAttrs.sourceClipId === 'string' ? clipAttrs.sourceClipId : null,
						}
					})
					return {
						name: typeof trackAttrs.name === 'string' ? trackAttrs.name : 'Track',
						kind: typeof trackAttrs.kind === 'string' ? trackAttrs.kind : null,
						clips: clipSummaries,
					}
				})
			},
			getActiveProjectPrimaryTracks: () => {
				const runtime = ownedHarness.pageRuntime
				const projectScope = getActiveProjectScope()
				if (!runtime || !projectScope) {
					return null
				}

				const videoTrack = runtime.readOne(projectScope, 'primaryVideoTrack')
				const audioTrack = runtime.readOne(projectScope, 'primaryAudioTrack')
				const readTrackName = (trackScope: ReturnType<typeof runtime.readOne>) => {
					if (!trackScope) {
						return null
					}
					const attrs = runtime.readAttrs(trackScope, ['name', 'kind']) as { name?: unknown; kind?: unknown }
					return {
						name: typeof attrs.name === 'string' ? attrs.name : 'Track',
						kind: typeof attrs.kind === 'string' ? attrs.kind : null,
					}
				}

				return {
					video: readTrackName(videoTrack),
					audio: readTrackName(audioTrack),
				}
			},
			getSelectionState: () => {
				const runtime = ownedHarness.pageRuntime
				const rootScope = runtime?.getRootScope()
				if (!runtime || !rootScope) {
					return null
				}
				const attrs = runtime.readAttrs(rootScope, ['selectedEntityId', 'selectedClipSummary']) as {
					selectedEntityId?: unknown
					selectedClipSummary?: unknown
				}
				const selectedClip = runtime.readOne(rootScope, 'selectedClip')
				const clipAttrs = selectedClip
					? runtime.readAttrs(selectedClip, ['sourceClipId', 'name', 'mediaKind']) as {
						sourceClipId?: unknown
						name?: unknown
						mediaKind?: unknown
					  }
					: null
				return {
					selectedEntityId: typeof attrs.selectedEntityId === 'string' ? attrs.selectedEntityId : null,
					selectedClipSummary: attrs.selectedClipSummary ?? null,
					selectedClip: clipAttrs
						? {
							sourceClipId: typeof clipAttrs.sourceClipId === 'string' ? clipAttrs.sourceClipId : null,
							name: typeof clipAttrs.name === 'string' ? clipAttrs.name : null,
							mediaKind: typeof clipAttrs.mediaKind === 'string' ? clipAttrs.mediaKind : null,
						}
						: null,
				}
			},
			getRuntimeMessages: () => ownedHarness.pageRuntime?.debugMessages?.() ?? [],
			getRole: () => {
				const worker = ownedHarness.worker as { role?: string }
				return typeof worker.role === 'string' ? worker.role : null
			},
			isRuntimeReady: () => {
				return ownedHarness.pageRuntime?.getSnapshot().ready ?? false
			},
			getPeerId: () => {
				const worker = ownedHarness.worker as { peerId?: string }
				return typeof worker.peerId === 'string' ? worker.peerId : null
			},
			createProject: (title?: string) => {
				ownedHarness.actions.createProject(title)
			},
			setCursor: (cursor: number) => {
				ownedHarness.actions.setCursor(cursor)
			},
			dispatchCreateProject: async (title?: string) => {
				const runtime = ownedHarness.pageRuntime
				if (!runtime) {
					throw new Error('Runtime not ready')
				}
				const TIMEOUT_MS = 15_000
				const POLL_MS = 50
				const deadline = Date.now() + TIMEOUT_MS
				while (!runtime.getSnapshot().ready) {
					if (Date.now() >= deadline) {
						const snap = runtime.getSnapshot()
						const role = (ownedHarness.worker as { role?: string }).role ?? null
						throw new Error(
							`Runtime not ready after ${TIMEOUT_MS}ms (role=${role} booted=${snap.booted} rootNodeId=${snap.rootNodeId})`,
						)
					}
					await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS))
				}
				ownedHarness.actions.createProject(title)
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
			<DktEditorRoot runtime={ownedHarness.pageRuntime} bootstrapOptions={resolvedDktBootstrapOptions}>
				<VideoEditorApp />
			</DktEditorRoot>
		</VideoEditorProvider>
	)
}
