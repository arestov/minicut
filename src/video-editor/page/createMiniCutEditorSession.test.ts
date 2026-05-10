import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const snapshot = {
		booted: false,
		ready: false,
		version: 0,
		rootNodeId: null as string | null,
		sessionId: null as string | null,
		sessionKey: null as string | null,
	};
	const runtime = {
		store: { subscribe: vi.fn(), getSnapshot: vi.fn(() => snapshot) },
		bootstrap: vi.fn(),
		debugDescribeNode: vi.fn((nodeId: string) => ({ nodeId })),
		debugDumpGraph: vi.fn(() => ({ rootNodeId: "root", nodes: [] })),
		debugMessages: vi.fn(() => [{ type: "debug" }]),
		dispatchAction: vi.fn(),
		getSnapshot: vi.fn(() => snapshot),
		destroy: vi.fn(),
	};
	const harness = {
		pageRuntime: runtime,
		destroy: vi.fn(),
	};

	return {
		createBrowserHarnessPlatform: vi.fn(() => ({ kind: "platform" })),
		createDefaultRtcConfig: vi.fn((iceServer: RTCIceServer | null) => ({
			iceServers: iceServer ? [iceServer] : [],
		})),
		createVideoEditorHarness: vi.fn(() => harness),
		harness,
		runtime,
		snapshot,
	};
});

vi.mock("../app/createVideoEditorHarness", () => ({
	createVideoEditorHarness: mockState.createVideoEditorHarness,
}));

vi.mock("../app/platform", () => ({
	createBrowserHarnessPlatform: mockState.createBrowserHarnessPlatform,
}));

vi.mock("../p2p/PageP2PManager", () => ({
	createDefaultRtcConfig: mockState.createDefaultRtcConfig,
}));

const resetBrowserUrl = (path = "/") => {
	window.history.replaceState(null, "", path);
	window.localStorage.clear();
};

describe("createMiniCutEditorSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetBrowserUrl();
	});

	test("creates a weather-style session facade with compact debug helpers", async () => {
		const { createMiniCutEditorSession } = await import(
			"./createMiniCutEditorSession"
		);
		const session = createMiniCutEditorSession();

		session.bootstrap();
		session.dispatchAction("setCursor", 1.25, null);

		expect(mockState.runtime.bootstrap).toHaveBeenCalledWith({
			sessionKey: "minicut-local",
		});
		expect(mockState.runtime.dispatchAction).toHaveBeenCalledWith(
			"setCursor",
			1.25,
			null,
		);
		expect(session.snapshot()).toBe(mockState.snapshot);
		expect(session.dumpGraph()).toEqual({ rootNodeId: "root", nodes: [] });
		expect(session.describeNode("root")).toEqual({ nodeId: "root" });
		expect(session.messages()).toEqual([{ type: "debug" }]);

		session.destroy();
		expect(mockState.harness.destroy).toHaveBeenCalledTimes(1);
	});

	test("uses the room id as DKT session key when P2P signal URL is enabled", async () => {
		resetBrowserUrl("/?signalUrl=ws%3A%2F%2Fexample.test%2Fsignal#/room-alpha");
		const { createMiniCutEditorSession } = await import(
			"./createMiniCutEditorSession"
		);
		const session = createMiniCutEditorSession();

		session.bootstrap();

		expect(mockState.runtime.bootstrap).toHaveBeenCalledWith({
			sessionKey: "room-alpha",
		});
		expect(mockState.createBrowserHarnessPlatform).toHaveBeenCalledWith(
			expect.objectContaining({
				authorityOptions: expect.objectContaining({
					p2p: expect.objectContaining({
						roomId: "room-alpha",
						signalUrl: "ws://example.test/signal",
					}),
				}),
			}),
		);
	});
});
