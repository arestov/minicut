import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReactScopeRuntimeContext } from "../../../dkt-react-sync/context/ReactScopeRuntimeContext";
import { ScopeContext } from "../../../dkt-react-sync/context/ScopeContext";
import { createTestReactScopeRuntime } from "../../../dkt-react-sync/test/createTestReactScopeRuntime";
import { materializeClipTimingReviewItem } from "../../dkt/review/features/clipTiming";
import { clipTimingConflictFixture } from "../../dkt/review/features/clipTiming/fixtures";
import { materializeDanglingResourceReviewItem } from "../../dkt/review/features/danglingResource";
import { danglingResourceConflictFixture } from "../../dkt/review/features/danglingResource/fixtures";
import { materializeDeleteVsEditReviewItem } from "../../dkt/review/features/deleteVsEdit";
import { deleteVsEditConflictFixture } from "../../dkt/review/features/deleteVsEdit/fixtures";
import { materializeTrackOrderReviewItem } from "../../dkt/review/features/trackOrder";
import { trackOrderConflictFixture } from "../../dkt/review/features/trackOrder/fixtures";
import type { MiniCutReviewItem } from "../../dkt/review/types";
import { ProjectReviewMode } from "./ProjectReviewMode";

const attrsFromReviewItem = (item: MiniCutReviewItem) => ({
	reviewItemId: item.id,
	conflictId: item.conflictId,
	projectId: item.projectId,
	kind: item.kind,
	status: item.status,
	title: item.title,
	affectedObjects: item.affectedObjects,
	preview: item.preview,
	availableActions: item.availableActions,
	actionTargets: item.actionTargets,
	source: item.source,
});

const renderProjectReviewMode = (item: MiniCutReviewItem) => {
	const runtime = createTestReactScopeRuntime({
		rootNodeId: "root",
		relsByNodeId: {
			root: { activeProject: "project:1" },
			"project:1": {
				reviewItems: [item.id],
				reviewSessions: ["review-session:project:1"],
			},
			"review-session:project:1": { activitySummaries: [] },
		},
		attrsByNodeId: {
			[item.id]: attrsFromReviewItem(item),
			"review-session:project:1": {
				reviewSessionId: "review-session:project:1",
				projectId: "project:1",
				selectedReviewItemId: item.id,
				openItemCount: 1,
			},
		},
	});

	render(
		<ReactScopeRuntimeContext.Provider value={runtime}>
			<ScopeContext.Provider value={runtime.getRootScope()}>
				<ProjectReviewMode />
			</ScopeContext.Provider>
		</ReactScopeRuntimeContext.Provider>,
	);

	return runtime;
};

describe("ProjectReviewMode review actions", () => {
	it("dispatches every clip timing review button to DKT owner scopes", async () => {
		const item = materializeClipTimingReviewItem({
			conflict: clipTimingConflictFixture,
			projectId: "project:1",
		});
		const runtime = renderProjectReviewMode(item);
		await screen.findByRole("region", { name: "Project review" });

		await userEvent.click(screen.getByRole("button", { name: "Choose current" }));
		await userEvent.click(screen.getByRole("button", { name: "Choose incoming" }));
		await userEvent.clear(screen.getByLabelText("Final duration"));
		await userEvent.type(screen.getByLabelText("Final duration"), "2.5");
		await userEvent.click(
			screen.getByRole("button", { name: "Apply final timing" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Park incoming on review track" }),
		);

		expect(runtime.dispatchCalls).toEqual([
			expect.objectContaining({
				actionName: "resolveClipTimingConflict",
				scopeNodeId: "clip:1",
				payload: expect.objectContaining({
					conflictId: "conflict:clip-timing",
					reviewItemId: "review:conflict:clip-timing",
					selectedVariant: "current",
				}),
			}),
			expect.objectContaining({
				actionName: "resolveClipTimingConflict",
				scopeNodeId: "clip:1",
				payload: expect.objectContaining({
					conflictId: "conflict:clip-timing",
					reviewItemId: "review:conflict:clip-timing",
					selectedVariant: "incoming",
				}),
			}),
			expect.objectContaining({
				actionName: "resolveClipTimingConflict",
				scopeNodeId: "clip:1",
				payload: expect.objectContaining({
					conflictId: "conflict:clip-timing",
					reviewItemId: "review:conflict:clip-timing",
					selectedVariant: "custom",
					duration: 2.5,
				}),
			}),
			expect.objectContaining({
				actionName: "parkIncomingVariantOnReviewTrack",
				scopeNodeId: "project:1",
				payload: expect.objectContaining({
					conflictId: "conflict:clip-timing",
					reviewItemId: "review:conflict:clip-timing",
					clipId: "clip:1",
					variant: "incoming",
				}),
			}),
		]);
	});

	it("dispatches every track order review button to the project scope", async () => {
		const item = materializeTrackOrderReviewItem({
			conflict: trackOrderConflictFixture,
			projectId: "project:1",
		});
		const runtime = renderProjectReviewMode(item);
		await screen.findByRole("region", { name: "Project review" });

		await userEvent.click(screen.getByRole("button", { name: "Keep current order" }));
		await userEvent.click(screen.getByRole("button", { name: "Apply incoming order" }));
		await userEvent.click(screen.getByRole("button", { name: "Save manual suggestion" }));
		await userEvent.click(screen.getByRole("button", { name: "Apply manual order" }));

		expect(runtime.dispatchCalls).toEqual([
			expect.objectContaining({
				actionName: "preserveCurrentTrackOrder",
				scopeNodeId: "project:1",
				payload: expect.objectContaining({ selectedOrder: "current" }),
			}),
			expect.objectContaining({
				actionName: "resolveTrackOrderConflict",
				scopeNodeId: "project:1",
				payload: expect.objectContaining({ selectedOrder: "incoming" }),
			}),
			expect.objectContaining({
				actionName: "createManualTrackOrderSuggestion",
				scopeNodeId: "project:1",
				payload: expect.objectContaining({ selectedOrder: "manual" }),
			}),
			expect.objectContaining({
				actionName: "resolveTrackOrderConflict",
				scopeNodeId: "project:1",
				payload: expect.objectContaining({ selectedOrder: "manual" }),
			}),
		]);
	});

	it("dispatches every delete-vs-edit review button to the project scope", async () => {
		const item = materializeDeleteVsEditReviewItem({
			conflict: deleteVsEditConflictFixture,
			projectId: "project:1",
		});
		const runtime = renderProjectReviewMode(item);
		await screen.findByRole("region", { name: "Project review" });

		expect(
			screen.queryByRole("button", {
				name: "resolve Delete Vs Edit By Restore Variant",
			}),
		).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: "park Edited Variant On Review Track",
			}),
		).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: "preserve Delete And Archive Incoming Edit",
			}),
		).toBeNull();

		await userEvent.click(
			screen.getByRole("button", { name: "Restore edited variant" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Park edited on review track" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Preserve delete and archive edit" }),
		);

		expect(runtime.dispatchCalls.map((call) => call.actionName)).toEqual([
			"resolveDeleteVsEditByRestoreVariant",
			"parkEditedVariantOnReviewTrack",
			"preserveDeleteAndArchiveIncomingEdit",
		]);
		expect(runtime.dispatchCalls.map((call) => call.scopeNodeId)).toEqual([
			"project:1",
			"project:1",
			"project:1",
		]);
	});

	it("dispatches every dangling resource review button to the materialized target scope", async () => {
		const item = materializeDanglingResourceReviewItem({
			conflict: danglingResourceConflictFixture,
			projectId: "project:1",
		});
		const runtime = renderProjectReviewMode(item);
		await screen.findByRole("region", { name: "Project review" });

		await userEvent.type(
			screen.getByLabelText("Replacement source"),
			"https://media.example/interview.mov",
		);
		await userEvent.click(screen.getByRole("button", { name: "Relink media" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Keep offline placeholder" }),
		);

		expect(runtime.dispatchCalls).toEqual([
			expect.objectContaining({
				actionName: "resolveDanglingResourceByRelink",
				scopeNodeId: "resource:1",
				payload: expect.objectContaining({
					resourceId: "resource:1",
					replacementUrl: "https://media.example/interview.mov",
				}),
			}),
			expect.objectContaining({
				actionName: "keepOfflinePlaceholder",
				scopeNodeId: "resource:1",
				payload: expect.objectContaining({ resourceId: "resource:1" }),
			}),
		]);
	});
});
