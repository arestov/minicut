import {
	hasExplicitRoomInHash,
	type RoomUrlResolution,
	resolveRoomUrlState,
} from "./roomUrlState";

export const LAST_ROOM_STORAGE_KEY = "minicut:last-room-id";
export const LAST_ROOM_LOCK_NAME = "minicut:last-room";

export interface BrowserRoomLockManager {
	request<T>(
		name: string,
		options: { mode: "exclusive" },
		callback: () => Promise<T> | T,
	): Promise<T>;
}

export interface BrowserRoomEnvironment {
	hash: string;
	storage: Pick<Storage, "getItem" | "setItem">;
	locks?: BrowserRoomLockManager | null;
	replaceHash(canonicalHash: string): void;
	generateRoomId?: () => string;
}

const resolveWithStorage = (
	env: BrowserRoomEnvironment,
): RoomUrlResolution => {
	const resolved = resolveRoomUrlState({
		hash: env.hash,
		lastRoomId: env.storage.getItem(LAST_ROOM_STORAGE_KEY),
		...(env.generateRoomId ? { generateRoomId: env.generateRoomId } : null),
	});
	env.storage.setItem(LAST_ROOM_STORAGE_KEY, resolved.roomId);
	return resolved;
};

/**
 * Picks the room before any room-scoped worker is created.
 *
 * An explicit `#<room>` or `#new` never takes the lock: it names its own
 * isolated room. Only the "no hash" path reads the remembered room, so tabs
 * opened concurrently on an empty storage must agree on one generated room;
 * the read-or-generate-and-store step runs under an exclusive Web Lock. Where
 * `navigator.locks` is missing the plain read/generate/write is used.
 */
export const resolveBrowserRoomWithEnvironment = async (
	env: BrowserRoomEnvironment,
): Promise<RoomUrlResolution> => {
	const resolved =
		!hasExplicitRoomInHash(env.hash) && env.locks
			? await env.locks.request(LAST_ROOM_LOCK_NAME, { mode: "exclusive" }, () =>
					resolveWithStorage(env),
				)
			: resolveWithStorage(env);
	if (resolved.shouldReplace) {
		env.replaceHash(resolved.canonicalHash);
	}
	return resolved;
};

export const resolveBrowserRoomAsync =
	async (): Promise<RoomUrlResolution | null> => {
		if (typeof window === "undefined") {
			return null;
		}
		const locks = (
			navigator as Navigator & { locks?: BrowserRoomLockManager }
		).locks;
		return resolveBrowserRoomWithEnvironment({
			hash: window.location.hash,
			storage: window.localStorage,
			locks: locks ?? null,
			replaceHash: (canonicalHash) =>
				window.history.replaceState(window.history.state, "", canonicalHash),
		});
	};
