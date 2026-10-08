import type { PageSyncRuntime } from "../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import {
	createVideoEditorHarness,
	type VideoEditorHarness,
} from "../app/createVideoEditorHarness";
import {
	resolveCollaborationMode,
	type CollaborationMode,
} from "../app/collaborationMode";
import { createBrowserHarnessPlatform } from "../app/platform";
import { resolveBrowserRoomAsync } from "../app/browserRoom";
import type { RoomUrlResolution } from "../app/roomUrlState";
import { createDefaultRtcConfig } from "../p2p/PageP2PManager";

const DEFAULT_SESSION_KEY = "minicut-local";

const resolveCrdtHarnessPeerId = (): string | null => {
	if (typeof window === "undefined") {
		return null;
	}
	const raw = new URLSearchParams(window.location.search).get("crdtPeerId");
	if (!raw) {
		return null;
	}
	const normalized = raw.trim().replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 80);
	return normalized || null;
};

const normalizeList = (raw: string | null | undefined): string[] =>
	String(raw ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

const resolveSignalUrl = (): string | null => {
	if (typeof window === "undefined") {
		return null;
	}

	const raw = new URLSearchParams(window.location.search).get("signalUrl");
	if (!raw) {
		const envSignalUrl = (import.meta.env as Record<string, unknown>)
			.VITE_MINICUT_SIGNAL_URL;
		if (typeof envSignalUrl !== "string" || envSignalUrl.length === 0) {
			return null;
		}

		try {
			return new URL(envSignalUrl, window.location.origin)
				.toString()
				.replace(/\/$/, "");
		} catch {
			return null;
		}
	}

	try {
		return new URL(raw, window.location.origin).toString().replace(/\/$/, "");
	} catch {
		return null;
	}
};

const resolveTurnIceServer = (): RTCIceServer | null => {
	if (typeof window === "undefined") {
		return null;
	}

	const params = new URLSearchParams(window.location.search);
	const env = import.meta.env as Record<string, unknown>;
	const queryUrls = params
		.getAll("turnUrl")
		.flatMap((value) => normalizeList(value));
	const envUrls = normalizeList(
		typeof env.VITE_MINICUT_TURN_URLS === "string"
			? env.VITE_MINICUT_TURN_URLS
			: undefined,
	);
	const urls = queryUrls.length > 0 ? queryUrls : envUrls;
	const username =
		params.get("turnUsername") ??
		(typeof env.VITE_MINICUT_TURN_USERNAME === "string"
			? env.VITE_MINICUT_TURN_USERNAME
			: null);
	const credential =
		params.get("turnCredential") ??
		(typeof env.VITE_MINICUT_TURN_CREDENTIAL === "string"
			? env.VITE_MINICUT_TURN_CREDENTIAL
			: null);

	if (urls.length === 0 || !username || !credential) {
		return null;
	}

	return {
		urls: urls.length === 1 ? urls[0] : urls,
		username,
		credential,
	};
};

const resolveMediaTransferOptions = (): {
	chunkSize?: number;
	chunkSendDelayMs?: number;
	headBytes?: number;
	tailBytes?: number;
	playheadWindowSeconds?: number;
} => {
	if (typeof window === "undefined") {
		return {};
	}

	const params = new URLSearchParams(window.location.search);
	const getNumber = (key: string): number | undefined => {
		const raw = params.get(key);
		if (!raw) {
			return undefined;
		}
		const parsed = Number(raw);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
	};

	return {
		chunkSize: getNumber("transferChunkSize"),
		chunkSendDelayMs: getNumber("transferChunkDelayMs"),
		headBytes: getNumber("transferHeadBytes"),
		tailBytes: getNumber("transferTailBytes"),
		playheadWindowSeconds: getNumber("transferPlayheadWindowSeconds"),
	};
};

const createBrowserHarness = (
	resolvedRoom: RoomUrlResolution | null,
	signalUrl: string | null,
	collaborationMode: CollaborationMode,
): VideoEditorHarness => {
	const mediaTransferOptions = resolveMediaTransferOptions();
	const workerName = resolvedRoom
		? `minicut-video-editor-dkt-runtime:${resolvedRoom.roomId}`
		: undefined;
	if (collaborationMode === "single" || !resolvedRoom || !signalUrl) {
		return createVideoEditorHarness(undefined, {
			mediaTransferOptions,
			platform: createBrowserHarnessPlatform({
				authorityOptions: { workerName },
			}),
		});
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
						console.warn("[minicut:p2p] app observed session loss", {
							roomId: resolvedRoom.roomId,
							reason,
						});
					},
					onError(error: unknown) {
						console.warn("[minicut:p2p] app observed p2p error", {
							roomId: resolvedRoom.roomId,
							error,
						});
					},
				},
			},
		}),
	});
};

export interface MiniCutEditorSession {
	harness: VideoEditorHarness;
	room: RoomUrlResolution | null;
	runtime: PageSyncRuntime | null;
	store: PageSyncRuntime["store"] | null;
	bootstrap(options?: Parameters<PageSyncRuntime["bootstrap"]>[0]): void;
	describeNode(nodeId: string): unknown;
	dispatchAction(
		actionName: string,
		payload?: unknown,
		scope?: ReactSyncScopeHandle | null,
	): void;
	dumpGraph(): unknown;
	messages(): readonly unknown[];
	snapshot(): ReturnType<PageSyncRuntime["getSnapshot"]> | null;
	destroy(): void;
}

/**
 * Resolves the room first: no room-scoped worker may exist before the room is
 * known, otherwise concurrent tabs could end up in different workers.
 */
export const createMiniCutEditorSession = async (): Promise<MiniCutEditorSession> => {
	const room = await resolveBrowserRoomAsync();
	const signalUrl = resolveSignalUrl();
	const collaborationMode =
		typeof window === "undefined"
			? "p2p"
			: resolveCollaborationMode({
					env: import.meta.env as Record<string, unknown>,
					searchParams: new URLSearchParams(window.location.search),
				});
	const harness = createBrowserHarness(room, signalUrl, collaborationMode);
	const runtime = harness.pageRuntime;
	const sessionKey = room?.roomId ?? DEFAULT_SESSION_KEY;
	const crdtPeerId = resolveCrdtHarnessPeerId();
	const sessionId =
		crdtPeerId && room
			? `${room.roomId}:peer:${crdtPeerId}`
			: sessionKey;

	return {
		harness,
		room,
		runtime,
		store: runtime?.store ?? null,
		bootstrap(options) {
			runtime?.bootstrap({ sessionId, sessionKey, ...options });
		},
		describeNode(nodeId) {
			return runtime?.debugDescribeNode(nodeId) ?? null;
		},
		dispatchAction(actionName, payload, scope) {
			runtime?.dispatchAction(actionName, payload, scope);
		},
		dumpGraph() {
			return runtime?.debugDumpGraph() ?? null;
		},
		messages() {
			return runtime?.debugMessages() ?? [];
		},
		snapshot() {
			return runtime?.getSnapshot() ?? null;
		},
		destroy() {
			harness.destroy();
		},
	};
};
