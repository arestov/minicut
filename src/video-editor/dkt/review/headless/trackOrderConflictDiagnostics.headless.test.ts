import { describe, expect, it } from "vitest";
import {
	createHeadlessReviewPair,
	type HeadlessDktModel,
	type HeadlessReviewPair,
	type HeadlessReviewPeer,
} from "./createHeadlessReviewPair";

type CrdtConflictRecord = {
	conflict_id?: unknown;
	kind?: unknown;
	node_id?: unknown;
	field_name?: unknown;
	aggregate?: unknown;
	payload?: unknown;
	status?: unknown;
};

const readTrackIds = async (peer: HeadlessReviewPeer): Promise<string[]> =>
	(await peer.ctx.queryRel(peer.project, "tracks")).map((track) =>
		String(track._node_id),
	);

const projectByTitle = async (
	peer: HeadlessReviewPeer,
	title: string,
): Promise<HeadlessDktModel> => {
	const projects = await peer.ctx.queryRel(peer.ctx.appModel, "project");
	for (const project of projects) {
		if ((await peer.ctx.queryAttr(project, "title")) === title) {
			return project;
		}
	}
	throw new Error(`Expected project ${title}`);
};

const bindActiveProject = async (
	peer: HeadlessReviewPeer,
	project: HeadlessDktModel,
) => {
	await peer.dispatch(peer.ctx.sessionRoot, "syncActiveProjectRel", { project });
	peer.project = project;
};

const createSharedTrackOrderProject = async (
	pair: HeadlessReviewPair,
	roomId: string,
) => {
	const title = `Headless track order diagnostic ${roomId}`;
	await pair.a.dispatch(pair.a.ctx.sessionRoot, "createProject", { title });
	pair.a.flushOutbound();
	await pair.waitForConvergence();
	const projectA = await projectByTitle(pair.a, title);
	const projectB = await projectByTitle(pair.b, title);
	await bindActiveProject(pair.a, projectA);
	await bindActiveProject(pair.b, projectB);
	await pair.a.dispatch(projectA, "addTrack", {
		kind: "video",
		name: "Overlay",
	});
	pair.a.flushOutbound();
	await pair.waitForConvergence();
};

const expectProjectTrackInverse = async (
	peer: HeadlessReviewPeer,
	stage: string,
) => {
	const tracks = await peer.ctx.queryRel(peer.project, "tracks");
	for (const track of tracks) {
		const projectRel = await peer.ctx.queryRel(track, "project");
		expect(projectRel.map((project) => project._node_id), stage).toEqual([
			peer.project._node_id,
		]);
	}
};

const projectTrackConflicts = (peer: HeadlessReviewPeer): CrdtConflictRecord[] =>
	(peer.ctx.runtime.crdt_runtime?.conflict_store?.readConflicts?.({
		aggregate: "projectTracks",
	}) ?? []) as CrdtConflictRecord[];

describe("headless track order conflict diagnostics", () => {
	it("records a raw sequence move conflict without breaking project track inverses", async () => {
		const roomId = "room-headless-track-order-diagnostics";
		const pair = await createHeadlessReviewPair(roomId);
		try {
			await createSharedTrackOrderProject(pair, roomId);
			await expectProjectTrackInverse(pair.a, "after createProject/A");
			await expectProjectTrackInverse(pair.b, "after createProject/B");

			const tracksA = await readTrackIds(pair.a);
			const tracksB = await readTrackIds(pair.b);
			expect(tracksA).toEqual(tracksB);
			expect(tracksA.length).toBeGreaterThanOrEqual(3);
			const movedTrackId = tracksA[1];
			const alternateAnchorId = tracksA[2];
			if (!movedTrackId || !alternateAnchorId) {
				throw new Error("Expected shared track ids for move conflict");
			}

			pair.partition();
			await pair.a.dispatch(pair.a.project, "moveTrackWithinProject", {
				trackId: movedTrackId,
				afterTrackId: null,
			});
			await expectProjectTrackInverse(pair.a, "after local move/A");
			await pair.b.dispatch(pair.b.project, "moveTrackWithinProject", {
				trackId: movedTrackId,
				afterTrackId: alternateAnchorId,
			});
			await expectProjectTrackInverse(pair.b, "after local move/B");

			pair.heal();
			await pair.waitForConvergence();
			await expectProjectTrackInverse(pair.a, "after convergence/A");
			await expectProjectTrackInverse(pair.b, "after convergence/B");

			for (const peer of [pair.a, pair.b]) {
				expect(projectTrackConflicts(peer)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							kind: "sequence_move_vs_move",
							node_id: pair.a.project._node_id,
							field_name: "tracks",
							aggregate: "projectTracks",
							payload: expect.objectContaining({
								current: expect.any(Object),
								incoming: expect.objectContaining({
									item_id: movedTrackId,
								}),
							}),
						}),
					]),
				);
			}
		} finally {
			pair.close();
		}
	});
});