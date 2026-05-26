const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,127}$/i;

export interface ResolveRoomUrlStateInput {
	hash: string;
	lastRoomId: string | null;
	generateRoomId?: () => string;
}

export interface RoomUrlResolution {
	roomId: string;
	canonicalHash: `#/${string}`;
	reason: "new" | "hash" | "storage" | "generated";
	shouldReplace: boolean;
}

export const normalizeRoomId = (
	value: string | null | undefined,
): string | null => {
	if (!value) {
		return null;
	}

	const trimmed = value
		.trim()
		.replace(/^#\//, "")
		.replace(/^#/, "")
		.replace(/^\//, "")
		.replace(/\/$/, "");
	if (!trimmed || /^new$/i.test(trimmed) || !ROOM_ID_PATTERN.test(trimmed)) {
		return null;
	}

	return trimmed.toLowerCase();
};

export const buildRoomHash = (roomId: string): `#/${string}` => `#/${roomId}`;

const defaultRoomIdGenerator = (): string => {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID().toLowerCase();
	}

	return `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const resolveRoomUrlState = ({
	hash,
	lastRoomId,
	generateRoomId = defaultRoomIdGenerator,
}: ResolveRoomUrlStateInput): RoomUrlResolution => {
	const normalizedHash = hash.trim();
	const explicitNew = /^#\/?new$/i.test(normalizedHash);
	const fromHash = normalizeRoomId(normalizedHash);

	if (explicitNew) {
		const roomId = normalizeRoomId(generateRoomId());
		if (!roomId) {
			throw new Error("Generated room id is invalid");
		}
		return {
			roomId,
			canonicalHash: buildRoomHash(roomId),
			reason: "new",
			shouldReplace: true,
		};
	}

	if (fromHash) {
		const canonicalHash = buildRoomHash(fromHash);
		return {
			roomId: fromHash,
			canonicalHash,
			reason: "hash",
			shouldReplace: canonicalHash !== normalizedHash,
		};
	}

	const fromStorage = normalizeRoomId(lastRoomId);
	if (fromStorage) {
		return {
			roomId: fromStorage,
			canonicalHash: buildRoomHash(fromStorage),
			reason: "storage",
			shouldReplace: true,
		};
	}

	const generated = normalizeRoomId(generateRoomId());
	if (!generated) {
		throw new Error("Generated room id is invalid");
	}

	return {
		roomId: generated,
		canonicalHash: buildRoomHash(generated),
		reason: "generated",
		shouldReplace: true,
	};
};
