import { describe, expect, it } from "vitest";
import {
	WORKSPACE_OPEN_FAILURE,
	WORKSPACE_OPEN_STATUS,
} from "../runtime/workspaceOpenState";
import { createMiniCutMaelstromProfiles } from "./sim/MiniCutMaelstromProfiles";
import type { MiniCutMaelstromProfile } from "./sim/MiniCutMaelstromProfiles";
import { createMiniCutCrdtSimulation } from "./sim/createMiniCutCrdtSimulation";

type RoomWorkspaceProfile = MiniCutMaelstromProfile & {
	workspaceIdForPeer: (peerId: string) => string;
	dbNameForPeer: (peerId: string) => string;
};

const roomWorkspaceProfile = (): RoomWorkspaceProfile => {
	const profile = createMiniCutMaelstromProfiles().find(
		(item) => item.name === "room-workspace-indexeddb",
	);
	if (!profile?.workspaceIdForPeer || !profile.dbNameForPeer) {
		throw new Error("Missing room-workspace-indexeddb maelstrom profile");
	}
	return profile as RoomWorkspaceProfile;
};

const readManifest = async (peer: ReturnType<Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>["peer"]>) => {
	const storage = peer.ctx.storagePackage?.dktStorage as
		| { getManifest?: () => Promise<unknown> }
		| undefined;
	return storage?.getManifest?.() ?? null;
};

const readProjectCount = async (peer: ReturnType<Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>["peer"]>) => {
	const snapshot = await (
		peer.ctx.storagePackage?.dktStorage as
			| { getSnapshot?: () => Promise<unknown> }
			| undefined
	)?.getSnapshot?.();
	const models = (snapshot as { models?: Record<string, { model_name?: unknown }> } | null)
		?.models;
	return Object.values(models ?? {}).filter(
		(model) => model.model_name === "project",
	).length;
};

describe("MiniCut maelstrom room workspace storage", () => {
	it("reopens the same room-derived workspace without adding a default project", async () => {
		const profile = roomWorkspaceProfile();
		const simulation = await createMiniCutCrdtSimulation({
			peers: ["A", "B"],
			roomId: profile.roomId,
			workspaceIdForPeer: profile.workspaceIdForPeer,
			storage: profile.storage,
			unloadModels: profile.unloadModels,
		});
		const peerA = simulation.peer("A");
		const expectedWorkspaceId = profile.workspaceIdForPeer("A");
		const expectedDbName = profile.dbNameForPeer("A");

		expect(expectedWorkspaceId).toContain("harness:room:");
		expect(expectedDbName).toContain("minicut-crdt-workspace-");
		expect(peerA.ctx.crdtStorageOpen).toMatchObject({
			ok: true,
			status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
			openState: {
				status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
				failureReason: WORKSPACE_OPEN_FAILURE.NONE,
			},
			manifest: { workspaceId: expectedWorkspaceId },
		});

		const initialManifest = await readManifest(peerA);
		expect(initialManifest).toMatchObject({
			workspaceId: expectedWorkspaceId,
			storageVersion: 1,
			schemaVersion: 1,
			profileId: "minicut-crdt-v1",
		});
		const projectCountBefore = await readProjectCount(peerA);
		expect(projectCountBefore).toBeGreaterThan(0);

		const restartedA = await simulation.reinitPeer("A");

		expect(restartedA.ctx.crdtStorageOpen).toMatchObject({
			ok: true,
			status: WORKSPACE_OPEN_STATUS.READY,
			openState: {
				status: WORKSPACE_OPEN_STATUS.READY,
				failureReason: WORKSPACE_OPEN_FAILURE.NONE,
			},
			manifest: { workspaceId: expectedWorkspaceId },
		});
		expect(await readManifest(restartedA)).toEqual(initialManifest);
		expect(await readProjectCount(restartedA)).toBe(projectCountBefore);
		expect(await restartedA.readProjectTitle()).toBe("MiniCut maelstrom project");
	});
});
