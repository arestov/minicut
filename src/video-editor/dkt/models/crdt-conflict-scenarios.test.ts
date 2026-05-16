import { describe, expect, it } from "vitest";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

const createPairWithClip = async (roomId: string) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	for (const peer of [pair.a, pair.b]) {
		await peer.dispatch(peer.videoTrack, "addClip", {
			name: "conflict-fixture.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
		drainCrdtOutbox(peer.ctx.runtime);
	}
	const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, "clips"))[0];
	if (!clipA || !clipB) {
		throw new Error("Expected matching clips");
	}
	expect(clipA._node_id).toBe(clipB._node_id);
	return { pair, clipA, clipB };
};

describe("MiniCut CRDT conflict scenarios", () => {
	it("records generated meta for concurrent timing edits", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-conflict-timing",
		);

		await pair.a.dispatch(clipA, "resize", { edge: "end", delta: -1 });
		const opsA = drainCrdtOutbox(pair.a.ctx.runtime);
		await pair.b.dispatch(clipB, "resize", { edge: "end", delta: -2 });
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

		pair.transportA.sendOps({ ops: opsA });
		pair.transportB.sendOps({ ops: opsB });
		await pair.waitForConvergence();

		expect(
			Number(
				pair.a.ctx.getAttr(
					clipA,
					"$meta$attrs$crdt$duration$open_conflicts_count",
				) ?? 0,
			),
		).toBeGreaterThan(0);
		expect(
			Number(
				pair.b.ctx.getAttr(
					clipB,
					"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
				) ?? 0,
			),
		).toBeGreaterThan(0);
		pair.close();
	});

	it.todo(
		"move vs move creates a sequence/owner conflict when DKT exposes deterministic move conflict projection for MiniCut Track.clips",
	);
	it.todo(
		"delete vs effect edit creates structural_delete_with_concurrent_activity when DKT owned-subtree detector covers MiniCut Clip.effects",
	);
	it.todo(
		"split vs delete creates a structural conflict when DKT sequence/lifecycle detector covers split-generated clips",
	);
});
