import { describe, expect, it } from "vitest";
import { danglingResourceConflictFixture } from "../../testHarness/fixtures/danglingResourceConflict";
import { trackOrderConflictFixture } from "../../testHarness/fixtures/trackOrderConflict";
import { deleteVsEditConflictFixture } from "./fixtures";
import { deleteVsEditFeature, materializeDeleteVsEditReviewItem } from ".";

describe("materializeDeleteVsEditReviewItem", () => {
	it("materializes delete-vs-edit conflicts with source metadata", () => {
		const item = materializeDeleteVsEditReviewItem({
			conflict: deleteVsEditConflictFixture,
			projectId: "project:1",
		});

		expect(item).toMatchObject({
			id: "review:opaque:delete-vs-edit",
			conflictId: "opaque:delete-vs-edit",
			projectId: "project:1",
			kind: "delete_vs_edit",
			title: "Deleted item was edited elsewhere",
			affectedObjects: [
				{ type: "clip", id: "clip:2", label: "Edited remote clip" },
				{ type: "resource", id: "resource:7", label: "Remote source.mov" },
			],
			availableActions: [
				"resolveDeleteVsEditByRestoreVariant",
				"parkEditedVariantOnReviewTrack",
				"preserveDeleteAndArchiveIncomingEdit",
			],
			actionTargets: {
				resolveDeleteVsEditByRestoreVariant: {
					type: "project",
					id: "project:1",
				},
				parkEditedVariantOnReviewTrack: {
					type: "project",
					id: "project:1",
				},
				preserveDeleteAndArchiveIncomingEdit: {
					type: "project",
					id: "project:1",
				},
			},
			source: {
				conflictGroupId: "group:delete-vs-edit",
				frameId: 31,
				rootFrameId: 30,
				syncBatchId: "peer-b:batch:3",
			},
		});
	});

	it("preserves edited variant attrs in preview", () => {
		const item = materializeDeleteVsEditReviewItem({
			conflict: deleteVsEditConflictFixture,
			projectId: "project:1",
		});

		expect(item.preview).toMatchObject({
			type: "delete_vs_edit",
			deletedVariant: {
				clipId: "clip:2",
				resourceId: "resource:7",
				peerId: "peer-a",
			},
			editedVariant: {
				clipAttrs: {
					name: "Edited remote clip",
					start: 5,
					duration: 2,
				},
				resourceAttrs: {
					name: "Remote source.mov",
					url: "minicut://resource/7",
				},
				effectAttrs: [{ name: "Brightness", amount: 0.2 }],
			},
		});
	});

	it("excludes pure dangling resource and track ordering conflicts", () => {
		expect(deleteVsEditFeature.canMaterialize(danglingResourceConflictFixture)).toBe(
			false,
		);
		expect(deleteVsEditFeature.canMaterialize(trackOrderConflictFixture)).toBe(
			false,
		);
	});

	it("does not recover clip ids from structural-delete conflict ids", () => {
		expect(() =>
			materializeDeleteVsEditReviewItem({
				conflict: {
					...deleteVsEditConflictFixture,
					conflict_id:
						"structural-delete:track:main:clips:clip:2:op:1:1",
					payload: { local_activity: "owned_subtree" },
					details: {},
				},
				projectId: "project:1",
			}),
		).toThrow("Delete-vs-edit conflict requires typed clips relation payload");
	});
});
