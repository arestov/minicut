import { afterEach, describe, expect, test } from "bun:test";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { DanglingResourcePreview } from "../../../video-editor/dkt/review/features/danglingResource";
import type { DeleteVsEditPreview } from "../../../video-editor/dkt/review/features/deleteVsEdit";
import type { MiniCutReviewItem, MiniCutReviewKind } from "../../../video-editor/dkt/review/types";
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

// Mirrors dkt/review/headless/{deleteVsEdit,danglingResource}.headless.test.ts
// through the GPUIX review screen, with conflicts made by real actions.

const TIMEOUT = 30_000;

type Fixture = {
	peers: ConflictPeers;
	project: Record<"a" | "b", ReactSyncScopeHandle>;
	tracks: Record<"a" | "b", readonly ReactSyncScopeHandle[]>;
	view: ReturnType<typeof renderOnPeer>;
	item: MiniCutReviewItem;
};

let fixture: Fixture | null = null;
let seq = 0;

afterEach(() => {
	fixture?.view.destroy();
	fixture?.peers.destroy();
	fixture = null;
});

const reviewItem = async (peer: ConflictPeer, project: ReactSyncScopeHandle) => {
	const [item] = await untilPeerMany(peer, project, "reviewItems", (n) => n >= 1);
	return (await untilPeerAttr(
		peer,
		item,
		"reviewItemSnapshot",
		(v) => v != null,
	)) as MiniCutReviewItem;
};

const finish = async (
	peers: ConflictPeers,
	project: Fixture["project"],
	tracks: Fixture["tracks"],
	kind: MiniCutReviewKind,
): Promise<Fixture> => {
	// Only the peer whose edit lost (A) gets a review item for these conflicts.
	await untilPeerAttr(peers.a, project.a, "reviewOpenItemCount", (v) => v === 1);
	const item = await reviewItem(peers.a, project.a);
	expect(item.kind).toBe(kind);
	// The entry point and the filtered list are model comps that settle after the item.
	await untilPeerAttr(peers.a, project.a, "hasReviewContent", (v) => v === true);
	await untilPeerMany(peers.a, project.a, "visibleReviewItems", (n) => n === 1);
	const view = renderOnPeer(peers.a, () => <AppShell />);
	view.settle();
	return { peers, project, tracks, view, item };
};

const deleteVsEditSetup = async (): Promise<Fixture> => {
	const peers = await createConflictPeers(`gpuix-delete-vs-edit-${(seq += 1)}`);
	const shared = await createSharedProject(peers);
	await peers.a.driver.run(
		"addTextClip",
		{
			name: "Headless delete edit",
			mediaKind: "text",
			start: 0,
			in: 0,
			duration: 4,
			text: { content: "Original title" },
		},
		shared.tracks[0],
	);
	const [clipA] = await peers.a.driver.waitMany(shared.tracks[0], "clips", 1);
	const joined = await joinSharedProject(peers, shared.project._nodeId);
	const [clipB] = await peers.b.driver.waitMany(joined.tracks[0], "clips", 1);
	await untilPeerAttr(peers.b, clipB, "duration", (v) => v === 4);
	peers.partition();
	await peers.a.driver.run("trim", { edge: "end", delta: -1 }, clipA);
	await peers.b.driver.run("removeSelf", undefined, clipB);
	peers.heal();
	return finish(
		peers,
		{ a: shared.project, b: joined.project },
		{ a: shared.tracks, b: joined.tracks },
		"delete_vs_edit",
	);
};

const danglingSetup = async (): Promise<Fixture> => {
	const peers = await createConflictPeers(`gpuix-dangling-${(seq += 1)}`);
	const shared = await createSharedProject(peers);
	await peers.a.driver.run(
		"importResource",
		{
			name: "headless-dangling-resource.webm",
			kind: "video",
			url: "memory://headless-dangling-resource.webm",
			mime: "video/webm",
			duration: 4,
			status: "ready",
		},
		shared.project,
	);
	const [resourceA] = await peers.a.driver.waitMany(shared.project, "resources", 1);
	await peers.a.driver.run("addResourceToTimeline", resourceA._nodeId, shared.project);
	await peers.a.driver.waitMany(shared.tracks[0], "clips", 1);
	const joined = await joinSharedProject(peers, shared.project._nodeId);
	const [resourceB] = await peers.b.driver.waitMany(joined.project, "resources", 1);
	await peers.b.driver.waitMany(joined.tracks[0], "clips", 1);
	await peers.b.driver.run("removeSelf", undefined, resourceB);
	return finish(
		peers,
		{ a: shared.project, b: joined.project },
		{ a: shared.tracks, b: joined.tracks },
		"dangling_resource",
	);
};

/** A's item is resolved and nothing is open on either peer. */
const expectResolved = async (current: Fixture) => {
	const { peers, project } = current;
	const [item] = await untilPeerMany(peers.a, project.a, "reviewItems", (n) => n >= 1);
	await untilPeerAttr(peers.a, item, "status", (v) => v === "resolved");
	await Promise.all([
		untilPeerAttr(peers.a, project.a, "reviewOpenItemCount", (v) => v === 0),
		untilPeerAttr(peers.b, project.b, "reviewOpenItemCount", (v) => v === 0),
	]);
	current.view.settle();
};

describe("review mode: a real delete-vs-edit conflict", () => {
	test("shows what each side did and offers restore, park and archive", async () => {
		const current = (fixture = await deleteVsEditSetup());
		const { view, item } = current;
		const preview = item.preview as DeleteVsEditPreview;

		expect(view.texts()).toContain("Review 1");
		expect(view.texts()).toContain("delete vs edit");
		expect(view.texts()).toEqual(expect.arrayContaining(["Deleted side", "Edited side"]));
		expect(view.textOf("dve-deleted-clip")).toBe(preview.deletedVariant.clipId);
		expect(view.texts()).toContain(String(preview.editedVariant.clipAttrs.name));
		expect(view.texts()).toContain("3s");
		expect(view.has("dve-restore")).toBe(true);
		expect(view.has("dve-park")).toBe(true);
		expect(view.has("dve-archive")).toBe(true);
	}, TIMEOUT);

	test("restores the edited variant as a new clip and resolves", async () => {
		const current = (fixture = await deleteVsEditSetup());
		const { peers, tracks, view, item } = current;
		const preview = item.preview as DeleteVsEditPreview;

		view.click("dve-restore");

		await expectResolved(current);
		for (const side of ["a", "b"] as const) {
			const restoreTrack = tracks[side].find(
				(track) => track._nodeId === preview.restoreTarget?.trackId,
			)!;
			const clips = await untilPeerScopes(peers[side], restoreTrack, "clips", (members) =>
				members.some((clip) => clip._nodeId !== preview.deletedVariant.clipId),
			);
			const restored = clips.find((clip) => clip._nodeId !== preview.deletedVariant.clipId)!;
			await untilPeerAttr(
				peers[side],
				restored,
				"name",
				(v) => v === preview.editedVariant.clipAttrs.name,
			);
		}
		expect(view.texts()).not.toContain("Review 1");
		expect(view.has("dve-restore")).toBe(false);

		// The list follows the model's status filter: the resolved item leaves the
		// default (unresolved) list and shows under Resolved.
		expect(view.texts()).not.toContain("delete vs edit · resolved");
		view.click("review-filter-resolved");
		await untilPeerAttr(peers.a, current.project.a, "reviewStatusFilter", (v) => v === "resolved");
		await untilPeerMany(peers.a, current.project.a, "visibleReviewItems", (n) => n === 1);
		view.settle();
		expect(view.texts()).toContain("delete vs edit · resolved");
	}, TIMEOUT);

	test("parks the edited variant on an incoming review track and resolves", async () => {
		const current = (fixture = await deleteVsEditSetup());
		const { peers, project, tracks, view } = current;

		view.click("dve-park");

		await expectResolved(current);
		for (const side of ["a", "b"] as const) {
			const all = await untilPeerMany(peers[side], project[side], "tracks", (n) => n >= 3);
			const known = new Set(tracks[side].map((track) => track._nodeId));
			const reviewTrack = all.find((track) => !known.has(track._nodeId))!;
			await peers[side].driver.waitMany(reviewTrack, "clips", 1);
		}
	}, TIMEOUT);

	test("preserves the delete and archives the edit, resolving", async () => {
		const current = (fixture = await deleteVsEditSetup());
		const { peers, project, view } = current;

		view.click("dve-archive");

		await expectResolved(current);
		await untilPeerMany(peers.a, project.a, "reviewArchiveEntries", (n) => n >= 1);
		expect(view.has("dve-archive")).toBe(false);
	}, TIMEOUT);
});

describe("review mode: a real dangling resource conflict", () => {
	test("names the missing resource, its affected clips and starts with Relink disabled", async () => {
		const current = (fixture = await danglingSetup());
		const { view, item } = current;
		const preview = item.preview as DanglingResourcePreview;

		expect(view.texts()).toContain("Review 1");
		expect(view.texts()).toContain("dangling resource");
		expect(view.textOf("dangling-name")).toBe(preview.resourceName);
		expect(view.countTexts("dangling-clip")).toBe(preview.clipIds.length);
		expect(view.has("dangling-offline")).toBe(true);
		const before = current.item;

		// Clicking Relink without a source sends nothing.
		const sent: string[] = [];
		const getDispatch = current.peers.a.runtime.getDispatch.bind(current.peers.a.runtime);
		current.peers.a.runtime.getDispatch = (scope) => {
			const dispatch = getDispatch(scope);
			return (action, payload, meta) => {
				sent.push(action);
				return dispatch(action, payload, meta);
			};
		};
		view.click("dangling-relink");
		expect(sent).toEqual([]);
		expect((await reviewItem(current.peers.a, current.project.a)).status).toBe(before.status);
	}, TIMEOUT);

	test("relinks the media from a typed source and resolves", async () => {
		const current = (fixture = await danglingSetup());
		const { peers, project, view, item } = current;
		const preview = item.preview as DanglingResourcePreview;

		view.type("dangling-url", "m e m o r y : / / r e l i n k . w e b m");
		view.click("dangling-kind-url");
		view.settle();
		view.click("dangling-relink");

		await expectResolved(current);
		for (const side of ["a", "b"] as const) {
			const resources = await untilPeerMany(peers[side], project[side], "resources", (n) => n >= 1);
			const resource = resources.find((entry) => entry._nodeId === preview.resourceId)!;
			await untilPeerAttr(peers[side], resource, "status", (v) => v === "ready");
		}
		expect(view.texts()).not.toContain("Review 1");
	}, TIMEOUT);

	test("keeps an offline placeholder and resolves", async () => {
		const current = (fixture = await danglingSetup());
		const { peers, project, view, item } = current;
		const preview = item.preview as DanglingResourcePreview;

		view.click("dangling-offline");

		await expectResolved(current);
		for (const side of ["a", "b"] as const) {
			const resources = await untilPeerMany(peers[side], project[side], "resources", (n) => n >= 1);
			const resource = resources.find((entry) => entry._nodeId === preview.resourceId)!;
			await untilPeerAttr(peers[side], resource, "status", (v) => v === "offline");
		}
	}, TIMEOUT);
});
