import { describe, expect, it } from "vitest";
import type { MiniCutReviewItem } from "../../dkt/review/types";
import { reviewActionScopeForItem } from "./reviewActionRouting";

const baseItem: MiniCutReviewItem = {
	id: "review:1",
	conflictId: "conflict:1",
	projectId: "project:1",
	kind: "unknown",
	status: "open",
	title: "CRDT conflict",
	affectedObjects: [],
	preview: { type: "unknown_conflict" },
	availableActions: [],
	actionTargets: {},
	source: { conflictId: "conflict:1" },
};

describe("reviewActionScopeForItem", () => {
	it("routes project-owned review actions to their materialized project scope", () => {
		const item: MiniCutReviewItem = {
			...baseItem,
			kind: "track_order",
			availableActions: ["resolveTrackOrderConflict"],
			actionTargets: {
				resolveTrackOrderConflict: { type: "project", id: "project:1" },
			},
		};

		expect(reviewActionScopeForItem(item, "resolveTrackOrderConflict")).toEqual({
			kind: "scope",
			_nodeId: "project:1",
		});
	});

	it("routes dangling resource actions through clip scope when clip target is materialized", () => {
		const item: MiniCutReviewItem = {
			...baseItem,
			kind: "dangling_resource",
			availableActions: ["resolveDanglingResourceByRelink"],
			actionTargets: {
				resolveDanglingResourceByRelink: { type: "clip", id: "clip:1" },
			},
		};

		expect(
			reviewActionScopeForItem(item, "resolveDanglingResourceByRelink"),
		).toEqual({
			kind: "scope",
			_nodeId: "clip:1",
		});
	});

	it("routes dangling resource actions through resource scope when only resource target is materialized", () => {
		const item: MiniCutReviewItem = {
			...baseItem,
			kind: "dangling_resource",
			availableActions: ["keepOfflinePlaceholder"],
			actionTargets: {
				keepOfflinePlaceholder: { type: "resource", id: "resource:1" },
			},
		};

		expect(reviewActionScopeForItem(item, "keepOfflinePlaceholder")).toEqual({
			kind: "scope",
			_nodeId: "resource:1",
		});
	});

	it("does not invent a scope when an action target is absent", () => {
		expect(reviewActionScopeForItem(baseItem, "missingAction")).toBeNull();
	});
});
