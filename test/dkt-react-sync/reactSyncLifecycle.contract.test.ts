import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import {
	R_UPDATE_TREE_BASE,
	SYRU_PRUNE_MODEL,
	SYRU_UPDATE_ATTRS,
	SYRU_UPDATE_RELS,
} from "dkt-all/libs/provoda/SyncR_U_TYPES.js";
import { describe, expect, it, vi } from "vitest";
import { ReactSyncReceiver } from "@dkt-ui-sync/receiver/ReactSyncReceiver";
import type { ReactSyncScopeHandle } from "@dkt-ui-sync/scope/ScopeHandle";
import { defineShape } from "@dkt-react-sync/shape/defineShape";
import {
	ShapeRegistry,
	type ShapeRegistryRuntime,
} from "@dkt-ui-sync/shape/ShapeRegistry";

const scope = (nodeId: string): ReactSyncScopeHandle => ({
	kind: "scope",
	_nodeId: nodeId,
});

const createShapeRuntime = (
	receiver: ReactSyncReceiver,
	requireNodeShapes = vi.fn(),
): ShapeRegistryRuntime => ({
	publishShapeGraph: vi.fn(),
	requireNodeShapes,
	readOne: (currentScope, relName) =>
		receiver.readOneScope(currentScope, relName),
	subscribeOne: (currentScope, relName, listener) =>
		receiver.subscribeNodeRel(currentScope._nodeId, relName, listener),
	readMany: (currentScope, relName) =>
		receiver.readManyScopes(currentScope, relName),
	subscribeMany: (currentScope, relName, listener) =>
		receiver.subscribeNodeList(currentScope._nodeId, relName, listener),
});

describe("DKT React sync shape lifecycle contract", () => {
	it("activates a child shape when its relation skeleton arrives before attrs", () => {
		const receiver = new ReactSyncReceiver(null);
		const registry = new ShapeRegistry();
		const requireNodeShapes = vi.fn();
		const runtime = createShapeRuntime(receiver, requireNodeShapes);
		const childShape = defineShape({ attrs: ["name"] });
		const rootShape = defineShape({ many: { children: childShape } });

		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "children", "name"]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "root",
			data: [null, null, null],
		});
		const stop = registry.mount(runtime, scope("root"), rootShape);

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			R_UPDATE_TREE_BASE,
			"child-1",
			null,
			null,
			null,
			SYRU_UPDATE_RELS,
			"root",
			1,
			["child-1"],
		]);

		expect(requireNodeShapes).toHaveBeenCalledWith("child-1", [childShape.id]);
		expect(receiver.readAttrs("child-1", ["name"]).name).toBeUndefined();

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			SYRU_UPDATE_ATTRS,
			"child-1",
			2,
			2,
			"Child 1",
		]);
		expect(receiver.readAttrs("child-1", ["name"]).name).toBe("Child 1");

		stop();
	});

	it("keeps independent shape mounts active until their own cleanup", () => {
		const receiver = new ReactSyncReceiver(null);
		const registry = new ShapeRegistry();
		const requireNodeShapes = vi.fn();
		const runtime = createShapeRuntime(receiver, requireNodeShapes);
		const titleShape = defineShape({ attrs: ["title"] });
		const statusShape = defineShape({ attrs: ["status"] });

		const stopTitle = registry.mount(runtime, scope("project-1"), titleShape);
		const stopStatus = registry.mount(runtime, scope("project-1"), statusShape);
		stopTitle();
		stopStatus();

		expect(requireNodeShapes.mock.calls).toEqual([
			["project-1", [titleShape.id]],
			["project-1", [titleShape.id, statusShape.id].sort()],
			["project-1", [statusShape.id]],
			["project-1", []],
		]);
	});

	it("drops pruned node state and accepts a recreated node with the same id", () => {
		const receiver = new ReactSyncReceiver(null);
		receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "name"]);
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			R_UPDATE_TREE_BASE,
			"clip-1",
			null,
			null,
			null,
			SYRU_UPDATE_ATTRS,
			"clip-1",
			2,
			1,
			"Old clip",
		]);
		const oldScope = receiver.getScope("clip-1");

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			SYRU_PRUNE_MODEL,
			["clip-1"],
			"tx-prune",
		]);
		expect(receiver.getNode("clip-1")).toBeNull();

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			R_UPDATE_TREE_BASE,
			"clip-1",
			null,
			null,
			null,
			SYRU_UPDATE_ATTRS,
			"clip-1",
			2,
			1,
			"Recreated clip",
		]);

		expect(receiver.getScope("clip-1")).not.toBe(oldScope);
		expect(receiver.readAttrs("clip-1", ["name"]).name).toBe(
			"Recreated clip",
		);
	});

	it("applies granular attr and relation diffs after initial delivery", () => {
		const receiver = new ReactSyncReceiver(null);
		const onTitle = vi.fn();
		const onTracks = vi.fn();
		receiver.handleSync(SYNCR_TYPES.SET_DICT, [
			undefined,
			"title",
			"tracks",
		]);
		receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
			node_id: "project-1",
			data: [null, null, null],
		});
		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			SYRU_UPDATE_ATTRS,
			"project-1",
			2,
			1,
			"Project 1",
			SYRU_UPDATE_RELS,
			"project-1",
			2,
			["track-1"],
		]);
		receiver.subscribeNodeAttrs("project-1", ["title"], onTitle);
		receiver.subscribeNodeList("project-1", "tracks", onTracks);

		receiver.handleSync(SYNCR_TYPES.UPDATE, [
			SYRU_UPDATE_ATTRS,
			"project-1",
			2,
			1,
			"Project 2",
			SYRU_UPDATE_RELS,
			"project-1",
			2,
			["track-1", "track-2"],
		]);

		expect(receiver.readAttrs("project-1", ["title"]).title).toBe("Project 2");
		expect(receiver.readRel("project-1", "tracks")).toEqual([
			"track-1",
			"track-2",
		]);
		expect(onTitle).toHaveBeenCalledTimes(1);
		expect(onTracks).toHaveBeenCalledTimes(1);
	});
});
