import { describe, expect, it } from "vitest";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createMiniCutRoomCrdtTransport } from "./createMiniCutRoomCrdtTransport";

type Model = DktTestContext["sessionRoot"];

const flushTransportOutbox = (ctx: DktTestContext) => {
	(ctx.runtime.crdt_runtime as { flushTransportOutbox?: () => unknown } | null)
		?.flushTransportOutbox?.();
};

const createPeer = async (
	peerId: string,
	roomId: string,
	relay: ReturnType<typeof createInMemoryCrdtRelay>,
	snapshot?: unknown,
) => {
	const transport = createMiniCutRoomCrdtTransport({
		relay,
		roomId,
		peerId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	const ctx = await bootDktModels({
		reinitFromSnapshot: snapshot,
		crdt: {
			enabled: true,
			peerId,
			storage: "memory",
			transport,
		},
		unloadModels: false,
	});
	if (!snapshot) {
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("createProject", {
				title: `Review peer ${peerId}`,
			});
		});
	} else {
		const projects = await ctx.queryRel(ctx.appModel, "project");
		const restoredProject =
			projects.find(
				(project) => ctx.getAttr(project, "title") === "Review peer A",
			) ?? projects[0];
		if (!restoredProject) {
			throw new Error("Expected restored project");
		}
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("syncActiveProjectRel", {
				project: restoredProject,
			});
		});
	}
	const [project] = await ctx.queryRel(ctx.sessionRoot, "activeProject");
	if (!project) {
		throw new Error("Expected active project");
	}
	return { ctx, project, transport };
};

const waitForTrackRole = async (
	ctx: DktTestContext,
	project: Model,
	role: string,
) => {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		await ctx.computed();
		const tracks = await ctx.queryRel(project, "tracks");
		const track = tracks.find((item) => ctx.getAttr(item, "trackRole") === role);
		if (track) {
			return track;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Expected synced review track ${role}`);
};

describe("review tracks CRDT sync", () => {
	it("syncs review track product attrs between peers", async () => {
		const relay = createInMemoryCrdtRelay();
		const roomId = "review-tracks-crdt-sync";
		const a = await createPeer("A", roomId, relay);
		await a.ctx.lockToRead(async () => {
			await a.project.dispatch("ensureIncomingReviewTrack", { kind: "video" });
		});
		await waitForTrackRole(a.ctx, a.project, "incomingReview");
		flushTransportOutbox(a.ctx);
		const snapshot = await toReinitableData(a.ctx.runtime);
		const b = await createPeer("B", roomId, relay, snapshot);
		await b.ctx.computed();
		flushTransportOutbox(b.ctx);

		const incomingB = await waitForTrackRole(
			b.ctx,
			b.project,
			"incomingReview",
		);
		expect(await b.ctx.queryAttr(incomingB, "name")).toBe("Incoming Review");
		expect(await b.ctx.queryAttr(incomingB, "enabled")).toBe(false);
		expect(await b.ctx.queryAttr(incomingB, "visibleInPreview")).toBe(false);
		expect(await b.ctx.queryAttr(incomingB, "muted")).toBe(true);
		expect(await b.ctx.queryAttr(incomingB, "isVisible")).toBe(true);

		await a.ctx.close();
		await b.ctx.close();
	});
});
