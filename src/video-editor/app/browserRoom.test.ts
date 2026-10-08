import {
	LAST_ROOM_LOCK_NAME,
	LAST_ROOM_STORAGE_KEY,
	type BrowserRoomEnvironment,
	type BrowserRoomLockManager,
	resolveBrowserRoomWithEnvironment,
} from "./browserRoom";

const createMemoryStorage = (initial: Record<string, string> = {}) => {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
};

/** Exclusive lock with a FIFO queue; callbacks run strictly one at a time. */
const createFakeLocks = () => {
	const requestedNames: string[] = [];
	let tail: Promise<unknown> = Promise.resolve();
	const locks: BrowserRoomLockManager = {
		request(name, _options, callback) {
			requestedNames.push(name);
			const run = tail.then(() => callback());
			tail = run.catch(() => undefined);
			return run;
		},
	};
	return { locks, requestedNames };
};

const createEnvironment = (
	overrides: Partial<BrowserRoomEnvironment> & Pick<BrowserRoomEnvironment, "storage">,
): BrowserRoomEnvironment & { replaced: string[] } => {
	const replaced: string[] = [];
	return {
		hash: "",
		locks: null,
		replaceHash: (canonicalHash) => {
			replaced.push(canonicalHash);
		},
		...overrides,
		replaced,
	};
};

describe("resolveBrowserRoomWithEnvironment", () => {
	it("gives concurrent tabs with empty storage one shared room", async () => {
		const storage = createMemoryStorage();
		const { locks, requestedNames } = createFakeLocks();
		let counter = 0;
		const generateRoomId = () => `generated-room-${++counter}`;

		const [first, second] = await Promise.all([
			resolveBrowserRoomWithEnvironment(
				createEnvironment({ storage, locks, generateRoomId }),
			),
			resolveBrowserRoomWithEnvironment(
				createEnvironment({ storage, locks, generateRoomId }),
			),
		]);

		expect(first.roomId).toBe("generated-room-1");
		expect(second.roomId).toBe("generated-room-1");
		expect(second.reason).toBe("storage");
		expect(storage.getItem(LAST_ROOM_STORAGE_KEY)).toBe("generated-room-1");
		expect(requestedNames).toEqual([LAST_ROOM_LOCK_NAME, LAST_ROOM_LOCK_NAME]);
	});

	it("reuses the remembered room under the lock when there is no hash", async () => {
		const storage = createMemoryStorage({ [LAST_ROOM_STORAGE_KEY]: "remembered" });
		const { locks, requestedNames } = createFakeLocks();
		const env = createEnvironment({ storage, locks });

		const room = await resolveBrowserRoomWithEnvironment(env);

		expect(room.roomId).toBe("remembered");
		expect(requestedNames).toEqual([LAST_ROOM_LOCK_NAME]);
		expect(env.replaced).toEqual(["#/remembered"]);
	});

	it("uses an explicit hash room without taking the lock", async () => {
		const storage = createMemoryStorage({ [LAST_ROOM_STORAGE_KEY]: "remembered" });
		const { locks, requestedNames } = createFakeLocks();

		const room = await resolveBrowserRoomWithEnvironment(
			createEnvironment({ storage, locks, hash: "#/other-room" }),
		);

		expect(room.roomId).toBe("other-room");
		expect(room.reason).toBe("hash");
		expect(requestedNames).toEqual([]);
		expect(storage.getItem(LAST_ROOM_STORAGE_KEY)).toBe("other-room");
	});

	it("creates a new separate room for #new without taking the lock", async () => {
		const storage = createMemoryStorage({ [LAST_ROOM_STORAGE_KEY]: "remembered" });
		const { locks, requestedNames } = createFakeLocks();
		const env = createEnvironment({
			storage,
			locks,
			hash: "#new",
			generateRoomId: () => "fresh-room",
		});

		const room = await resolveBrowserRoomWithEnvironment(env);

		expect(room.roomId).toBe("fresh-room");
		expect(room.reason).toBe("new");
		expect(requestedNames).toEqual([]);
		expect(env.replaced).toEqual(["#/fresh-room"]);
	});

	it("falls back to the plain read/generate/write without a locks API", async () => {
		const storage = createMemoryStorage();
		const room = await resolveBrowserRoomWithEnvironment(
			createEnvironment({
				storage,
				locks: undefined,
				generateRoomId: () => "no-locks-room",
			}),
		);

		expect(room.roomId).toBe("no-locks-room");
		expect(storage.getItem(LAST_ROOM_STORAGE_KEY)).toBe("no-locks-room");
	});
});
