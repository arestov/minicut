import { afterEach, describe, expect, test } from "bun:test";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";
import { AppShell } from "../AppShell";
import {
	type ConflictPeer,
	type ConflictPeers,
	createConflictPeers,
	createSharedProject,
	joinSharedProject,
	renderOnPeer,
	untilPeerAttr,
	untilPeerMany,
} from "../test/conflictPeers";

// Mirrors tests/integration/crdt-real-conflict-ux.spec.ts: two peers edit the
// same clip while partitioned, the conflict comes from the CRDT engine, and
// the review UI resolves it on both peers.

type Timing = { start: number; in: number; duration: number };

type Fixture = {
	peers: ConflictPeers;
	project: Record<"a" | "b", ReactSyncScopeHandle>;
	tracks: Record<"a" | "b", readonly ReactSyncScopeHandle[]>;
	clip: Record<"a" | "b", ReactSyncScopeHandle>;
	view: ReturnType<typeof renderOnPeer>;
};

let fixture: Fixture | null = null;
let seq = 0;
const TIMEOUT = 30_000;

afterEach(() => {
	fixture?.view.destroy();
	fixture?.peers.destroy();
	fixture = null;
});

const setup = async (): Promise<Fixture> => {
	const peers = await createConflictPeers(`gpuix-timing-${(seq += 1)}`);
	const shared = await createSharedProject(peers);
	await peers.a.driver.run(
		"addClip",
		{ name: "conflict.webm", mediaKind: "video", start: 0, in: 0, duration: 4 },
		shared.tracks[0],
	);
	const [clipA] = await peers.a.driver.waitMany(shared.tracks[0], "clips", 1);
	const joined = await joinSharedProject(peers, shared.project._nodeId);
	const [clipB] = await peers.b.driver.waitMany(joined.tracks[0], "clips", 1);
	await untilPeerAttr(peers.b, clipB, "duration", (v) => v === 4);

	// The review UI is up before the conflict exists, as on a running app.
	const view = renderOnPeer(peers.a, () => <AppShell />);
	view.settle();
	return {
		peers,
		project: { a: shared.project, b: joined.project },
		tracks: { a: shared.tracks, b: joined.tracks },
		clip: { a: clipA, b: clipB },
		view,
	};
};

const makeTimingConflict = async (current: Fixture) => {
	const { peers, project, clip } = current;
	peers.partition();
	await peers.a.driver.run("trim", { edge: "end", delta: -1 }, clip.a);
	await peers.b.driver.run("trim", { edge: "end", delta: -2 }, clip.b);
	peers.heal();
	await Promise.all([
		untilPeerAttr(peers.a, project.a, "reviewOpenItemCount", (v) => v === 1),
		untilPeerAttr(peers.b, project.b, "reviewOpenItemCount", (v) => v === 1),
	]);
	// The list and inspector render once the item snapshot has reached the page.
	await reviewItem(peers.a, project.a);
	current.view.settle();
};

/** Records the actions the UI sends on this peer (and still sends them). */
const recordDispatches = (peer: ConflictPeer) => {
	const sent: Array<{ action: string; scope: string | null; payload: unknown }> = [];
	const getDispatch = peer.runtime.getDispatch.bind(peer.runtime);
	peer.runtime.getDispatch = (scope) => {
		const dispatch = getDispatch(scope);
		return (action, payload, meta) => {
			sent.push({ action, scope: scope?._nodeId ?? null, payload });
			return dispatch(action, payload, meta);
		};
	};
	return sent;
};

const reviewItem = async (peer: ConflictPeer, project: ReactSyncScopeHandle) => {
	const [item] = await untilPeerMany(peer, project, "reviewItems", (n) => n >= 1);
	return (await untilPeerAttr(
		peer,
		item,
		"reviewItemSnapshot",
		(v) => v != null,
	)) as MiniCutReviewItem;
};

const previewTimings = async (current: Fixture) => {
	const item = await reviewItem(current.peers.a, current.project.a);
	const preview = item.preview as { current: Timing; incoming: Timing };
	return { item, current: preview.current, incoming: preview.incoming };
};

/** The item is resolved on both peers and nothing is open any more. */
const expectResolvedOnBoth = async (current: Fixture) => {
	const { peers, project } = current;
	for (const side of ["a", "b"] as const) {
		const peer = peers[side];
		const [item] = await untilPeerMany(peer, project[side], "reviewItems", (n) => n >= 1);
		await untilPeerAttr(peer, item, "status", (v) => v === "resolved");
		await untilPeerAttr(peer, project[side], "reviewOpenItemCount", (v) => v === 0);
	}
	current.view.settle();
};

const expectClipDurationOnBoth = async (current: Fixture, duration: number) => {
	await Promise.all([
		untilPeerAttr(current.peers.a, current.clip.a, "duration", (v) => v === duration),
		untilPeerAttr(current.peers.b, current.clip.b, "duration", (v) => v === duration),
	]);
};

describe("review mode: a real clip timing conflict", () => {
	test("the toolbar shows the open count and review mode lists the clip timing item on the peer that sees it", async () => {
		const current = (fixture = await setup());
		// Without conflicts there is no review entry point.
		expect(current.view.has("review-trigger")).toBe(false);

		await makeTimingConflict(current);
		const { view } = current;

		expect(view.texts()).toContain("Review 1");
		// New open conflicts bring review mode up.
		expect(view.has("review-mode")).toBe(true);
		expect(view.texts()).toContain("Project review");
		expect(view.texts()).toContain("1 open / 1 total");
		expect(view.texts()).toContain("Clip timing conflict");
		expect(view.texts().some((text) => text.includes("clip timing"))).toBe(true);
		// Same on the second peer: the conflict is real on both sides.
		expect(await reviewItem(current.peers.b, current.project.b)).toMatchObject({
			kind: "clip_timing",
			status: "open",
		});
	}, TIMEOUT);

	test("review mode can be left and re-entered from the toolbar button", async () => {
		const current = (fixture = await setup());
		await makeTimingConflict(current);
		const { view } = current;
		expect(view.has("review-mode")).toBe(true);

		view.click("review-close");
		view.settle();
		expect(view.has("review-mode")).toBe(false);
		expect(view.has("preview-panel")).toBe(true);
		expect(view.texts()).toContain("Review 1");

		view.click("review-trigger");
		view.settle();
		expect(view.has("review-mode")).toBe(true);
		expect(view.texts()).toContain("Clip timing conflict");
	}, TIMEOUT);

	test("shows current and incoming timing and parks the incoming variant on a review track on both peers", async () => {
		const current = (fixture = await setup());
		await makeTimingConflict(current);
		const { view, peers, project } = current;
		const { current: sourceTiming, incoming: parkedTiming } = await previewTimings(current);

		expect(view.texts()).toEqual(
			expect.arrayContaining([`${sourceTiming.duration}s`, `${parkedTiming.duration}s`]),
		);

		view.click("timing-park-incoming");
		await expectResolvedOnBoth(current);

		// The clip keeps the current timing, the incoming one lives on a new review track.
		await expectClipDurationOnBoth(current, sourceTiming.duration);
		for (const side of ["a", "b"] as const) {
			const tracks = await untilPeerMany(peers[side], project[side], "tracks", (n) => n >= 3);
			const known = new Set(current.tracks[side].map((track) => track._nodeId));
			const reviewTrack = tracks.find((track) => !known.has(track._nodeId))!;
			const parked = await peers[side].driver.waitMany(reviewTrack, "clips", 1);
			expect(parked).toHaveLength(1);
			await untilPeerAttr(
				peers[side],
				parked[0],
				"duration",
				(v) => v === parkedTiming.duration,
			);
		}

		// Resolved item: result summary, no more actions, nothing left open.
		expect(view.texts()).toContain("Resolution result");
		expect(view.has("timing-park-incoming")).toBe(false);
		expect(view.texts()).not.toContain("Review 1");
		expect(view.texts()).toContain("0 open / 1 total");
	}, TIMEOUT);

	test("accepting the incoming timing sends the incoming variant and both peers converge on it", async () => {
		const current = (fixture = await setup());
		await makeTimingConflict(current);
		const { view, peers } = current;
		const { incoming } = await previewTimings(current);
		const sent = recordDispatches(peers.a);

		view.click("timing-choose-incoming");

		expect(sent).toEqual([
			{
				action: "resolveClipTimingConflict",
				scope: current.clip.a._nodeId,
				payload: expect.objectContaining({
					selectedVariant: "incoming",
					duration: incoming.duration,
				}),
			},
		]);
		await expectClipDurationOnBoth(current, incoming.duration);
	}, TIMEOUT);

	// Not asserted here: "the item is resolved on both peers" after accepting the
	// incoming or a custom timing. The same flow fails in the headless suite
	// (dkt/review/headless/clipTiming.headless.test.ts, incoming and custom cases)
	// because the dispatching peer keeps the item open; a known DKT-side failure.
	test.todo("accepting the incoming timing resolves the review item on both peers", () => {});
	test.todo("applying a final timing resolves the review item on both peers", () => {});

	// Not covered: acknowledging. The UI sends acknowledgeReviewItem to the session
	// root exactly like Web's ProjectReviewMode, but only AppRoot defines that
	// action ("missing action handler in model" on session_root), so the button
	// cannot work until the model routes it (model change; see the stage report).
	test.todo("acknowledging marks the item acknowledged on both peers without changing the clip", () => {});

	test("keeps the current timing on both peers", async () => {
		const current = (fixture = await setup());
		await makeTimingConflict(current);
		const { view } = current;
		const { current: kept } = await previewTimings(current);

		view.click("timing-choose-current");
		await expectResolvedOnBoth(current);

		await expectClipDurationOnBoth(current, kept.duration);
		expect(view.texts()).toContain("Resolution result");
	}, TIMEOUT);

	test("applies the edited final timing: the field is typed into and the custom variant is sent", async () => {
		const current = (fixture = await setup());
		await makeTimingConflict(current);
		const { view, peers } = current;
		await previewTimings(current);
		const sent = recordDispatches(peers.a);

		// The final duration starts from the current timing (3s); replace it with 2.5.
		view.type("timing-final-duration", "backspace 2 . 5");
		view.settle();
		view.click("timing-apply-final");

		expect(sent).toEqual([
			{
				action: "resolveClipTimingConflict",
				scope: current.clip.a._nodeId,
				payload: expect.objectContaining({ selectedVariant: "custom", duration: 2.5 }),
			},
		]);
		// Only the dispatching peer is awaited: convergence of a custom value on
		// both peers belongs to the known failing headless "custom" case.
		await untilPeerAttr(peers.a, current.clip.a, "duration", (v) => v === 2.5);
	}, TIMEOUT);
});
