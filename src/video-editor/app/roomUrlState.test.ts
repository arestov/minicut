import {
	buildRoomHash,
	normalizeRoomId,
	resolveRoomUrlState,
} from "./roomUrlState";

describe("room url state", () => {
	it("generates a room id for #new", () => {
		const state = resolveRoomUrlState({
			hash: "#new",
			lastRoomId: "remembered-room",
			generateRoomId: () => "fresh-room",
		});

		expect(state).toEqual({
			roomId: "fresh-room",
			canonicalHash: "#/fresh-room",
			reason: "new",
			shouldReplace: true,
		});
	});

	it("reuses storage room id when hash is empty", () => {
		const state = resolveRoomUrlState({
			hash: "#/",
			lastRoomId: "remembered-room",
			generateRoomId: () => "fresh-room",
		});

		expect(state).toEqual({
			roomId: "remembered-room",
			canonicalHash: "#/remembered-room",
			reason: "storage",
			shouldReplace: true,
		});
	});

	it("uses valid hash room id and preserves canonical hash", () => {
		const state = resolveRoomUrlState({
			hash: buildRoomHash("linked-room"),
			lastRoomId: "remembered-room",
			generateRoomId: () => "fresh-room",
		});

		expect(state).toEqual({
			roomId: "linked-room",
			canonicalHash: "#/linked-room",
			reason: "hash",
			shouldReplace: false,
		});
	});

	it("normalizes uppercase and slash variants to canonical room hash", () => {
		const state = resolveRoomUrlState({
			hash: "#/Room_ABC/",
			lastRoomId: null,
			generateRoomId: () => "fresh-room",
		});

		expect(state.roomId).toBe("room_abc");
		expect(state.canonicalHash).toBe("#/room_abc");
		expect(state.reason).toBe("hash");
		expect(state.shouldReplace).toBe(true);
	});

	it("normalizes only valid public room ids", () => {
		expect(normalizeRoomId("alpha-1")).toBe("alpha-1");
		expect(normalizeRoomId("  /alpha_1/  ")).toBe("alpha_1");
		expect(normalizeRoomId("new")).toBe(null);
		expect(normalizeRoomId("bad key")).toBe(null);
	});
});
