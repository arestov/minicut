import { afterEach, describe, expect, test } from "bun:test";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { TrackOrderPreview } from "../../../video-editor/dkt/review/features/trackOrder";
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
	untilPeerScopes,
} from "../test/conflictPeers";

// Mirrors dkt/review/headless/trackOrder.headless.test.ts through the GPUIX
// review screen: both peers move the same track while partitioned.

const TIMEOUT = 30_000;

type Fixture = {
	peers: ConflictPeers;
	project: Record<"a" | "b", ReactSyncScopeHandle>;
	view: ReturnType<typeof renderOnPeer>;
};

let fixture: Fixture | null = null;
let seq = 0;

afterEach(() => {
	fixture?.view.destroy();
	fixture?.peers.destroy();
	fixture = null;
});

const trackIds = async (peer: ConflictPeer, project: ReactSyncScopeHandle) =>
	(await untilPeerScopes(peer, project, "tracks", () => true)).map((track) => track._nodeId);

const setup = async (): Promise<Fixture> => {
	const peers = await createConflictPeers(`gpuix-track-order-${(seq += 1)}`);
	const shared = await createSharedProject(peers);
	await peers.a.driver.run("addTrack", { kind: "video", name: "Overlay" }, shared.project);
	await peers.a.driver.waitMany(shared.project, "tracks", 3);
	const joined = await joinSharedProject(peers, shared.project._nodeId);
	await peers.b.driver.waitMany(joined.project, "tracks", 3);
	const project = { a: shared.project, b: joined.project };

	const view = renderOnPeer(peers.a, () => <AppShell />);
	const [, , moved] = await trackIds(peers.a, project.a);
	const [first] = await trackIds(peers.b, project.b);
	peers.partition();
	await peers.a.driver.run("moveTrackWithinProject", { trackId: moved, afterTrackId: null }, project.a);
	await peers.b.driver.run(
		"moveTrackWithinProject",
		{ trackId: moved, afterTrackId: first },
		project.b,
	);
	peers.heal();
	await Promise.all([
		untilPeerAttr(peers.a, project.a, "reviewOpenItemCount", (v) => v === 1),
		untilPeerAttr(peers.b, project.b, "reviewOpenItemCount", (v) => v === 1),
	]);
	const item = await reviewItem(peers.a, project.a);
	expect(item.kind).toBe("track_order");
	await untilPeerAttr(peers.a, project.a, "hasReviewContent", (v) => v === true);
	await untilPeerMany(peers.a, project.a, "visibleReviewItems", (n) => n >= 1);
	view.settle();
	return { peers, project, view };
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

const preview = async (current: Fixture) =>
	(await reviewItem(current.peers.a, current.project.a)).preview as TrackOrderPreview;

const ids = (order: TrackOrderPreview["currentOrder"]) => order.map((entry) => entry.trackId);

const expandOrder = (subset: string[], all: string[]) => [
	...subset,
	...all.filter((id) => !subset.includes(id)),
];

const expectOrderOnBoth = async (current: Fixture, expected: string[]) => {
	for (const side of ["a", "b"] as const) {
		await untilPeerScopes(
			current.peers[side],
			current.project[side],
			"tracks",
			(tracks) => tracks.map((track) => track._nodeId).join() === expected.join(),
		);
	}
};

const expectResolvedOnBoth = async (current: Fixture) => {
	for (const side of ["a", "b"] as const) {
		await untilPeerAttr(
			current.peers[side],
			current.project[side],
			"reviewOpenItemCount",
			(v) => v === 0,
		);
		const [item] = await untilPeerMany(
			current.peers[side],
			current.project[side],
			"reviewItems",
			(n) => n >= 1,
		);
		await untilPeerAttr(current.peers[side], item, "status", (v) => v === "resolved");
	}
	current.view.settle();
};

describe("review mode: a real track order conflict", () => {
	test("lists the track order item with both orders, a manual order and the moved track", async () => {
		const current = (fixture = await setup());
		const { view } = current;
		const order = await preview(current);

		expect(view.texts()).toContain("Review 1");
		expect(view.texts()).toContain("track order");
		expect(view.texts()).toEqual(
			expect.arrayContaining(["Current order", "Incoming order", "Manual order"]),
		);
		const names = order.movedTrackIds.map(
			(id) => order.currentOrder.find((entry) => entry.trackId === id)!.name,
		);
		expect(view.texts()).toContain(`Moved tracks: ${names.join(", ")}`);
		expect(view.findAll("track-order-current-row")).toHaveLength(order.currentOrder.length);
		expect(view.findAll("track-order-incoming-row")).toHaveLength(order.incomingOrder.length);
		expect(view.findAll("track-order-manual-row")).toHaveLength(order.currentOrder.length);
	}, TIMEOUT);

	test("keeps the current order on both peers", async () => {
		const current = (fixture = await setup());
		const { peers, project, view } = current;
		const order = await preview(current);
		const expected = expandOrder(ids(order.currentOrder), await trackIds(peers.a, project.a));

		view.click("track-order-keep-current");

		await expectResolvedOnBoth(current);
		await expectOrderOnBoth(current, expected);
		expect(view.texts()).not.toContain("Review 1");
		expect(view.has("track-order-keep-current")).toBe(false);
	}, TIMEOUT);

	test("applies the incoming order on both peers", async () => {
		const current = (fixture = await setup());
		const { peers, project, view } = current;
		const order = await preview(current);
		const expected = expandOrder(ids(order.incomingOrder), await trackIds(peers.a, project.a));

		view.click("track-order-apply-incoming");

		await expectResolvedOnBoth(current);
		await expectOrderOnBoth(current, expected);
	}, TIMEOUT);

	test("reorders the manual list with Up and saves it as a suggestion without resolving", async () => {
		const current = (fixture = await setup());
		const { peers, project, view } = current;
		const order = await preview(current);
		const original = await trackIds(peers.a, project.a);
		const reversed = [...ids(order.currentOrder)].reverse();

		// Reverse the manual list: move each entry up until it is in place.
		const target = [...ids(order.currentOrder)];
		for (let index = 0; index < reversed.length; index += 1) {
			const wanted = reversed[index];
			let at = target.indexOf(wanted);
			while (at > index) {
				view.click(`track-order-up-${wanted}`);
				view.settle();
				target.splice(at, 1);
				target.splice(at - 1, 0, wanted);
				at -= 1;
			}
		}
		view.click("track-order-save-manual");

		// The item stays open and now carries the manual order; nothing moved.
		const updated = await untilPeerAttr(
			peers.a,
			(await untilPeerMany(peers.a, project.a, "reviewItems", (n) => n >= 1))[0],
			"reviewItemSnapshot",
			(v) => Boolean((v as MiniCutReviewItem | null)?.preview && (v as { preview: TrackOrderPreview }).preview.manualOrder),
		);
		const saved = updated as MiniCutReviewItem;
		expect(saved.status).toBe("open");
		expect(ids((saved.preview as TrackOrderPreview).manualOrder!)).toEqual(reversed);
		expect(await trackIds(peers.a, project.a)).toEqual(original);
		expect(view.texts()).toContain("Review 1");
	}, TIMEOUT);

	test("applies the manual order on both peers", async () => {
		const current = (fixture = await setup());
		const { peers, project, view } = current;
		const order = await preview(current);
		const current0 = ids(order.currentOrder);
		const all = await trackIds(peers.a, project.a);
		// Move the last entry to the top: one Up per position.
		const last = current0[current0.length - 1];
		for (let step = 0; step < current0.length - 1; step += 1) {
			view.click(`track-order-up-${last}`);
			view.settle();
		}
		const expected = expandOrder([last, ...current0.slice(0, -1)], all);

		view.click("track-order-apply-manual");

		await expectResolvedOnBoth(current);
		await expectOrderOnBoth(current, expected);
	}, TIMEOUT);
});
