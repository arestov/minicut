import { afterEach, describe, expect, test } from "bun:test";
import { createTestReactScopeRuntime } from "../../../dkt-ui-sync/test/createTestReactScopeRuntime";
import { renderInRootScope } from "../../../dkt-solid-sync/test/renderSolid";
import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";
import { ReviewMode } from "./ReviewMode";
import { ReviewModeProvider, useReviewMode } from "./reviewModeState";
import { ReviewTrigger } from "./ReviewTrigger";

// Review screens against scripted model data: states that real two-peer
// flows do not produce (resolved results, rejected activity, unknown kinds).

const timing = (duration: number) => ({
	start: 0,
	in: 0,
	duration,
	fadeIn: 0,
	fadeOut: 0,
});

const clipTimingItem = (
	patch: Partial<MiniCutReviewItem> = {},
): MiniCutReviewItem => ({
	id: "review:timing",
	conflictId: "conflict:timing",
	projectId: "project",
	kind: "clip_timing",
	status: "open",
	title: "Clip timing conflict",
	affectedObjects: [{ type: "clip", id: "clip:1", label: "Intro" }],
	preview: {
		type: "clip_timing",
		current: timing(4),
		incoming: timing(3),
		fields: ["duration"],
	},
	resolution: null,
	availableActions: ["resolveClipTimingConflict", "parkIncomingVariantOnReviewTrack"],
	actionTargets: {
		resolveClipTimingConflict: { type: "clip", id: "clip:1" },
		parkIncomingVariantOnReviewTrack: { type: "project", id: "project" },
	},
	source: { conflictId: "conflict:timing", conflictGroupId: "group:1" },
	...patch,
});

type Data = {
	items?: MiniCutReviewItem[];
	summaries?: Array<Record<string, unknown>>;
	openCount?: number;
	hasSession?: boolean;
};

const build = (data: Data) => {
	const items = data.items ?? [];
	const summaries = data.summaries ?? [];
	const attrsByNodeId: Record<string, Record<string, unknown>> = {
		project: {
			reviewOpenItemCount:
				data.openCount ?? items.filter((item) => item.status === "open").length,
		},
	};
	const relsByNodeId: Record<string, Record<string, string | string[] | null>> = {
		root: { activeProject: "project", pioneer: "app" },
		project: {
			reviewItems: items.map((item) => `item:${item.id}`),
			reviewSessions: data.hasSession ? ["session"] : [],
			activitySummaries: summaries.map((_, index) => `summary:${index}`),
		},
	};
	for (const item of items) {
		attrsByNodeId[`item:${item.id}`] = { reviewItemSnapshot: item };
	}
	summaries.forEach((summary, index) => {
		attrsByNodeId[`summary:${index}`] = summary;
	});
	return createTestReactScopeRuntime({ attrsByNodeId, relsByNodeId });
};

type View = ReturnType<typeof renderInRootScope>;
let view: View | null = null;
afterEach(() => {
	view?.unmount();
	view = null;
});

const OpenReview = () => {
	useReviewMode().open();
	return <ReviewMode />;
};

const show = (runtime: ReturnType<typeof build>) => {
	view = renderInRootScope(runtime, () => (
		<ReviewModeProvider>
			<OpenReview />
		</ReviewModeProvider>
	));
	return view;
};

const click = (current: View, testId: string, index = 0) => {
	const element = current.renderer
		.findByType("div")
		.filter((candidate) => candidate.testId === testId)[index];
	if (!element) throw new Error(`No element ${index} with testId "${testId}"`);
	const bounds = current.renderer.getElementBounds(element.id)!;
	current.renderer.nativeSimulateClick(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
};

describe("review list and selection", () => {
	test("lists every item with its kind and status and the model open count", () => {
		const runtime = build({
			items: [
				clipTimingItem(),
				clipTimingItem({
					id: "review:ack",
					conflictId: "c:ack",
					title: "Acknowledged one",
					status: "acknowledged",
				}),
				clipTimingItem({
					id: "review:done",
					conflictId: "c:done",
					title: "Resolved one",
					status: "resolved",
				}),
			],
		});
		const current = show(runtime);

		expect(current.texts()).toContain("1 open / 3 total");
		expect(current.texts()).toEqual(
			expect.arrayContaining([
				"clip timing · open",
				"clip timing · acknowledged",
				"clip timing · resolved",
			]),
		);
	});

	test("selecting another row shows that item in the inspector", () => {
		const runtime = build({
			items: [
				clipTimingItem(),
				clipTimingItem({ id: "review:second", conflictId: "c:2", title: "Second conflict" }),
			],
		});
		const current = show(runtime);
		expect(current.texts()).toContain("conflict:timing");

		click(current, "review-item", 1);
		current.flushSync(() => {});

		expect(current.texts()).toContain("c:2");
		expect(current.texts()).not.toContain("conflict:timing");
	});

	test("an empty project says there are no items and nothing selected", () => {
		const runtime = build({ items: [], hasSession: true });
		const current = show(runtime);

		expect(current.texts()).toContain("0 open / 0 total");
		expect(current.texts()).toContain("No review items");
		expect(current.texts()).toContain("No review item selected");
	});
});

describe("review actions", () => {
	test("choosing the current timing is sent to the clip scope with the conflict ids", () => {
		const runtime = build({ items: [clipTimingItem()] });
		const current = show(runtime);

		click(current, "timing-choose-current");

		expect(runtime.dispatchCalls).toEqual([
			{
				actionName: "resolveClipTimingConflict",
				scopeNodeId: "clip:1",
				meta: undefined,
				payload: expect.objectContaining({
					conflict_id: "conflict:timing",
					review_item_id: "review:timing",
					selectedVariant: "current",
					duration: 4,
				}),
			},
		]);
	});

	test("parking goes to the project scope and acknowledging goes to the app model", () => {
		const runtime = build({ items: [clipTimingItem()] });
		const current = show(runtime);

		click(current, "timing-park-incoming");
		click(current, "review-acknowledge");

		expect(
			runtime.dispatchCalls.map((call) => [call.actionName, call.scopeNodeId]),
		).toEqual([
			["parkIncomingVariantOnReviewTrack", "project"],
			["acknowledgeReviewItem", "app"],
		]);
		expect(runtime.dispatchCalls[1].payload).toEqual({
			conflict_id: "conflict:timing",
			review_item_id: "review:timing",
		});
	});

	test("actions that no feature inspector owns are offered as plain buttons", () => {
		const runtime = build({
			items: [
				clipTimingItem({
					kind: "unknown",
					title: "Something else",
					preview: null,
					availableActions: ["archiveEverything"],
					actionTargets: { archiveEverything: { type: "project", id: "project" } },
				}),
			],
		});
		const current = show(runtime);

		expect(current.texts()).toContain("No preview available");
		expect(current.texts()).toContain("archive Everything");
		click(current, "review-action-archiveEverything");

		expect(runtime.dispatchCalls).toEqual([
			expect.objectContaining({
				actionName: "archiveEverything",
				scopeNodeId: "project",
			}),
		]);
	});

	test("an item without an action target sends nothing", () => {
		const runtime = build({ items: [clipTimingItem({ actionTargets: {} })] });
		const current = show(runtime);

		click(current, "timing-choose-current");

		expect(runtime.dispatchCalls).toEqual([]);
	});
});

describe("resolved and unusual items", () => {
	test("a resolved clip timing item shows what was applied and offers no actions", () => {
		const runtime = build({
			items: [
				clipTimingItem({
					status: "resolved",
					resolution: {
						domain_result: {
							selectedVariant: "incoming",
							sourceTiming: timing(3),
							parkedClipId: "clip:parked",
						},
					},
				}),
			],
		});
		const current = show(runtime);

		expect(current.texts()).toEqual(
			expect.arrayContaining([
				"Resolution result",
				"incoming applied",
				"Applied timing",
				"Parked variant: clip:parked",
			]),
		);
		expect(current.texts()).toContain("3s");
		expect(current.renderer.findByTestId("timing-choose-current")).toBeUndefined();
		expect(current.renderer.findByTestId("review-acknowledge")).toBeUndefined();
	});

	test("a resolved item without details says so", () => {
		const runtime = build({ items: [clipTimingItem({ status: "resolved" })] });
		const current = show(runtime);

		expect(current.texts()).toContain("Resolution details unavailable");
	});

	test("a preview of the wrong shape shows a note instead of failing", () => {
		const runtime = build({
			items: [clipTimingItem({ kind: "track_order", preview: { type: "clip_timing" } })],
		});
		const current = show(runtime);

		expect(current.texts()).toContain("Track order preview unavailable");
	});
});

describe("activity", () => {
	test("lists batches with counts, rejected ops and the conflicts they opened", () => {
		const runtime = build({
			items: [clipTimingItem()],
			summaries: [
				{
					batchId: "peer-b:batch:1",
					title: "Peer B changes",
					created: [{ type: "clip", id: "clip:1" }],
					updated: [
						{ type: "clip", id: "clip:2", label: "start" },
						{ type: "clip", id: "clip:3", label: "duration", status: "rejected" },
					],
					deleted: [],
					openedConflictIds: ["conflict:timing"],
					updatedConflictIds: [],
				},
			],
		});
		const current = show(runtime);

		expect(current.texts()).toEqual(
			expect.arrayContaining([
				"Activity",
				"Batch peer-b:batch:1",
				"Peer B changes",
				"1 created · 2 updated · 0 deleted · 1 rejected",
			]),
		);
		// The inspector shows the conflict id and the activity row links to it.
		expect(
			current.renderer.getAllText().filter((text) => text === "conflict:timing"),
		).toHaveLength(2);
	});

	test("says there is no sync activity without summaries", () => {
		const current = show(build({ items: [clipTimingItem()] }));

		expect(current.texts()).toContain("No sync activity");
	});
});

describe("entry point", () => {
	const Probe = () => (
		<text testId="mode-open">{useReviewMode().isOpen() ? "mode open" : "mode closed"}</text>
	);
	const renderTrigger = (runtime: ReturnType<typeof build>) => {
		view = renderInRootScope(runtime, () => (
			<ReviewModeProvider>
				<ReviewTrigger />
				<Probe />
			</ReviewModeProvider>
		));
		return view;
	};

	test("is absent without review data and carries the open count otherwise", () => {
		const none = renderTrigger(build({ items: [] }));
		expect(none.texts()).not.toContain("Review");
		none.unmount();

		const some = renderTrigger(build({ items: [clipTimingItem()] }));
		expect(some.texts()).toContain("Review 1");
	});

	test("open conflicts bring review mode up and the button toggles it", () => {
		const current = renderTrigger(build({ items: [clipTimingItem()] }));
		expect(current.texts()).toContain("mode open");

		click(current, "review-trigger");
		current.flushSync(() => {});
		expect(current.texts()).toContain("mode closed");

		click(current, "review-trigger");
		current.flushSync(() => {});
		expect(current.texts()).toContain("mode open");
	});

	test("stays closed when the only items are already handled", () => {
		const current = renderTrigger(
			build({ items: [clipTimingItem({ status: "resolved" })], openCount: 0 }),
		);

		expect(current.texts()).toContain("Review");
		expect(current.texts()).toContain("mode closed");
	});
});
