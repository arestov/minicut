import { describe, expect, it } from "vitest";
import type { CrdtConflictRecord } from "../../types";
import { danglingResourceConflictFixture } from "./fixtures";
import {
	danglingResourceFeature,
	materializeDanglingResourceReviewItem,
} from "./index";

describe("materializeDanglingResourceReviewItem", () => {
	it("materializes dangling resource conflicts for the Review queue", () => {
		const item = materializeDanglingResourceReviewItem({
			conflict: danglingResourceConflictFixture,
			projectId: "project:1",
		});

		expect(item).toMatchObject({
			id: "review:conflict:dangling-resource",
			conflictId: "conflict:dangling-resource",
			projectId: "project:1",
			kind: "dangling_resource",
			status: "open",
			title: "Missing media reference",
			affectedObjects: [
				{
					type: "resource",
					id: "resource:1",
					label: "Interview missing.mov",
				},
				{ type: "clip", id: "clip:1", label: "Clip" },
			],
			availableActions: [
				"resolveDanglingResourceByRelink",
				"keepOfflinePlaceholder",
			],
			actionTargets: {
				resolveDanglingResourceByRelink: { type: "project", id: "project:1" },
				keepOfflinePlaceholder: { type: "project", id: "project:1" },
			},
		});
		expect(item.preview).toMatchObject({
			type: "dangling_resource",
			resourceId: "resource:1",
			resourceName: "Interview missing.mov",
			resourceKind: "video",
			clipIds: ["clip:1"],
			missingUrl: "file:///offline/interview-missing.mov",
			lastKnownSource: { kind: "file", name: "interview-missing.mov" },
		});
	});

	it("classifies missing resource relation conflicts", () => {
		const conflict: CrdtConflictRecord = {
			...danglingResourceConflictFixture,
			aggregate: null,
			kind: "relation_missing",
			field_kind: "rel",
			field_name: "resource",
		};

		expect(danglingResourceFeature.canMaterialize(conflict)).toBe(true);
	});

	it("uses the resourceLifecycle anchor node as the resource id", () => {
		const item = materializeDanglingResourceReviewItem({
			conflict: {
				...danglingResourceConflictFixture,
				model_name: "resourceLifecycle",
				payload: { clipIds: ["clip:1"] },
			},
			projectId: "project:1",
		});

		expect(item.preview).toMatchObject({
			type: "dangling_resource",
			resourceId: "resource:1",
			clipIds: ["clip:1"],
		});
	});

	it("targets project actions so tombstoned resources can be restored", () => {
		const item = materializeDanglingResourceReviewItem({
			conflict: {
				...danglingResourceConflictFixture,
				payload: {
					resourceId: "resource:1",
					resourceName: "Interview missing.mov",
				},
			},
			projectId: "project:1",
		});

		expect(item.actionTargets).toEqual({
			resolveDanglingResourceByRelink: {
				type: "project",
				id: "project:1",
			},
			keepOfflinePlaceholder: { type: "project", id: "project:1" },
		});
	});

	it("does not classify delete-vs-edit clip lifecycle conflicts", () => {
		const conflict: CrdtConflictRecord = {
			...danglingResourceConflictFixture,
			kind: "delete_vs_edit",
			aggregate: "clipLifecycle",
			model_name: "clip",
		};

		expect(danglingResourceFeature.canMaterialize(conflict)).toBe(false);
	});

	it("throws when a DKT conflict record does not identify the resource", () => {
		expect(() =>
			materializeDanglingResourceReviewItem({
				conflict: {
					...danglingResourceConflictFixture,
					node_id: null,
					model_name: "clip",
					payload: { clipIds: ["clip:1"] },
				},
				projectId: "project:1",
			}),
		).toThrow("Dangling resource conflict requires resource id");
	});
});
