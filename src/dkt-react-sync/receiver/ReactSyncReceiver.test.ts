import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { describe, expect, it, vi } from "vitest";
import { ReactSyncReceiver } from "./ReactSyncReceiver";

describe("ReactSyncReceiver", () => {
	it("reads attrs and rel scopes from DKT sync chunks with stable cached snapshots", () => {
		const receiver = new ReactSyncReceiver(null);
		const onRoot = vi.fn();
		const onAttrs = vi.fn();
		const onTracks = vi.fn();

		receiver.subscribeRoot(onRoot);
		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "name", "tracks"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "project-1",
			data: [null, null, null],
		});

		receiver.subscribeNodeAttrs("project-1", ["name"], onAttrs);
		receiver.subscribeNodeList("project-1", "tracks", onTracks);

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			0,
			"project-1",
			2,
			1,
			"Project 1",
			1,
			"project-1",
			2,
			["track-1", "track-2"],
		]);

		expect(onRoot).toHaveBeenCalledTimes(1);
		expect(onAttrs).toHaveBeenCalledTimes(1);
		expect(onTracks).toHaveBeenCalledTimes(1);
		expect(receiver.getRootScope()?._nodeId).toBe("project-1");

		const attrs1 = receiver.readRootAttrs(["name"]);
		const attrs2 = receiver.readRootAttrs(["name"]);
		expect(attrs1).toBe(attrs2);
		expect(attrs1.name).toBe("Project 1");

		const rootScope = receiver.getRootScope();
		if (!rootScope) {
			throw new Error("Expected root scope");
		}
		const scopes1 = receiver.readManyScopes(rootScope, "tracks");
		const scopes2 = receiver.readManyScopes(rootScope, "tracks");
		expect(scopes1).toBe(scopes2);
		expect(scopes1.map((scope) => scope._nodeId)).toEqual([
			"track-1",
			"track-2",
		]);
	});

	it("does not notify rel listeners when a rel payload is structurally unchanged", () => {
		const receiver = new ReactSyncReceiver(null);
		const onTracks = vi.fn();

		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "tracks"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "project-1",
			data: [null, null, null],
		});

		receiver.subscribeNodeList("project-1", "tracks", onTracks);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [1, "project-1", 1, ["track-1"]]);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [1, "project-1", 1, ["track-1"]]);

		expect(onTracks).toHaveBeenCalledTimes(1);
	});

	it("invalidates cached attr snapshots only when requested attr values change", () => {
		const receiver = new ReactSyncReceiver(null);

		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "name", "status"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "project-1",
			data: [null, null, null],
		});
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			0,
			"project-1",
			4,
			1,
			"Project 1",
			2,
			"ready",
		]);

		const first = receiver.readRootAttrs(["name"]);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [0, "project-1", 2, 2, "loading"]);
		const unchangedSelection = receiver.readRootAttrs(["name"]);
		const changedSelection = receiver.readRootAttrs(["name", "status"]);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			0,
			"project-1",
			2,
			1,
			"Project 2",
		]);
		const changedName = receiver.readRootAttrs(["name"]);

		expect(unchangedSelection).toBe(first);
		expect(changedSelection).not.toBe(first);
		expect(changedSelection).toMatchObject({
			name: "Project 1",
			status: "loading",
		});
		expect(changedName).not.toBe(first);
		expect(changedName.name).toBe("Project 2");
	});

	it("returns the previous many snapshot for structurally equal rel arrays", () => {
		const receiver = new ReactSyncReceiver(null);

		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "clips"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "track-1",
			data: [null, null, null],
		});
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			1,
			"track-1",
			1,
			["clip-1", "clip-2"],
		]);

		const scope = receiver.getRootScope();
		if (!scope) {
			throw new Error("Expected root scope");
		}
		const first = receiver.readManyScopes(scope, "clips");
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			1,
			"track-1",
			1,
			["clip-1", "clip-2"],
		]);
		const second = receiver.readManyScopes(scope, "clips");
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			1,
			"track-1",
			1,
			["clip-1", "clip-2", "clip-3"],
		]);
		const third = receiver.readManyScopes(scope, "clips");

		expect(second).toBe(first);
		expect(third).not.toBe(first);
		expect(third.map((item) => item._nodeId)).toEqual([
			"clip-1",
			"clip-2",
			"clip-3",
		]);
	});

	it("applies relation cleanup before pruning a model in the same update", () => {
		const receiver = new ReactSyncReceiver(null);
		const onClips = vi.fn();
		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "clips", "name"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "track-1",
			data: [null, null, null],
		});
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			3, "clip-1", null, null, null,
			0, "clip-1", 2, 2, "Clip 1",
			1, "track-1", 1, ["clip-1"],
		]);
		receiver.subscribeNodeList("track-1", "clips", onClips);

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			1, "track-1", 1, [],
			7, ["clip-1"], "dkt-tx-1",
		]);

		expect(receiver.getNode("clip-1")).toBeNull();
		expect(receiver.readRel("track-1", "clips")).toEqual([]);
		expect(onClips).toHaveBeenCalledTimes(1);
	});

	it("cleans stale replica refs and reports an out-of-order prune in dev", () => {
		const receiver = new ReactSyncReceiver(null);
		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "clips"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "track-1",
			data: [null, null, null],
		});
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			1, "track-1", 1, ["clip-1"],
		]);

		expect(() =>
			receiver.handleSync(SYNCR_TYPES.UPDATE, [
				7, ["clip-1"], "dkt-tx-stale",
			]),
		).toThrow("pruned model still referenced in React replica");
		expect(receiver.getNode("clip-1")).toBeNull();
		expect(receiver.readRel("track-1", "clips")).toEqual([]);
	});

	it("treats repeated prune chunks as idempotent and drops node caches", () => {
		const receiver = new ReactSyncReceiver(null);
		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "name"]);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			3, "clip-1", null, null, null,
			0, "clip-1", 2, 1, "Clip 1",
		]);
		const previousScope = receiver.getScope("clip-1");
		expect(receiver.readAttrs("clip-1", ["name"]).name).toBe("Clip 1");

		receiver.handleSync(SYNCR_TYPES.UPDATE, [7, ["clip-1"], "dkt-tx-1"]);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [7, ["clip-1"], "dkt-tx-1"]);

		expect(receiver.readAttrs("clip-1", ["name"])).toEqual({});
		expect(receiver.getScope("clip-1")).not.toBe(previousScope);
	});
});
