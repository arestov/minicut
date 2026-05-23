import type { DktTestContext } from "../../testingInit";

type DktModel = DktTestContext["appModel"];

export type ReviewGraphAttrs = Record<string, unknown>;

export type ReviewGraphNodeSnapshot = {
	nodeId: string | null;
	modelName: string | null;
	attrs: ReviewGraphAttrs;
};

export type ReviewGraphSessionSnapshot = ReviewGraphNodeSnapshot & {
	items: ReviewGraphNodeSnapshot[];
	activitySummaries: ReviewGraphNodeSnapshot[];
};

export type ReviewGraphSnapshot = {
	root: ReviewGraphNodeSnapshot;
	reviewSessions: ReviewGraphSessionSnapshot[];
	rootReviewItems: ReviewGraphNodeSnapshot[];
	rootActivitySummaries: ReviewGraphNodeSnapshot[];
};

const REVIEW_SESSION_ATTRS = [
	"reviewSessionId",
	"projectId",
	"status",
	"selectedReviewItemId",
	"filters",
	"openItemCount",
] as const;

const REVIEW_ITEM_ATTRS = [
	"reviewItemId",
	"conflictId",
	"projectId",
	"kind",
	"status",
	"title",
	"affectedObjects",
	"availableActions",
	"source",
] as const;

const ACTIVITY_SUMMARY_ATTRS = [
	"activitySummaryId",
	"projectId",
	"batchId",
	"originPeerId",
	"title",
	"created",
	"updated",
	"deleted",
	"rootFrames",
] as const;

const ROOT_ATTRS = ["activeProjectHint", "activeReviewItemId"] as const;

const nodeId = (model: DktModel | null | undefined): string | null =>
	typeof model?._node_id === "string" ? model._node_id : null;

const modelName = (model: DktModel | null | undefined): string | null =>
	typeof model?.model_name === "string" ? model.model_name : null;

const readAttrs = async (
	ctx: DktTestContext,
	model: DktModel,
	attrNames: readonly string[],
): Promise<ReviewGraphAttrs> => {
	const entries = await Promise.all(
		attrNames.map(async (name) => [name, await ctx.queryAttr(model, name)] as const),
	);
	return Object.fromEntries(entries);
};

const inspectNode = async (
	ctx: DktTestContext,
	model: DktModel,
	attrNames: readonly string[],
): Promise<ReviewGraphNodeSnapshot> => ({
	nodeId: nodeId(model),
	modelName: modelName(model),
	attrs: await readAttrs(ctx, model, attrNames),
});

export const inspectReviewGraph = async (
	ctx: DktTestContext,
	root: DktModel = ctx.appModel,
): Promise<ReviewGraphSnapshot> => {
	const [reviewSessions, rootReviewItems, rootActivitySummaries] =
		await Promise.all([
			ctx.queryRel(root, "reviewSession"),
			ctx.queryRel(root, "reviewItem"),
			ctx.queryRel(root, "activitySummary"),
		]);

	const sessions = await Promise.all(
		reviewSessions.map(async (session) => {
			const [items, activitySummaries, base] = await Promise.all([
				ctx.queryRel(session, "items"),
				ctx.queryRel(session, "activitySummaries"),
				inspectNode(ctx, session, REVIEW_SESSION_ATTRS),
			]);
			return {
				...base,
				items: await Promise.all(
					items.map((item) => inspectNode(ctx, item, REVIEW_ITEM_ATTRS)),
				),
				activitySummaries: await Promise.all(
					activitySummaries.map((summary) =>
						inspectNode(ctx, summary, ACTIVITY_SUMMARY_ATTRS),
					),
				),
			};
		}),
	);

	return {
		root: await inspectNode(ctx, root, ROOT_ATTRS),
		reviewSessions: sessions,
		rootReviewItems: await Promise.all(
			rootReviewItems.map((item) => inspectNode(ctx, item, REVIEW_ITEM_ATTRS)),
		),
		rootActivitySummaries: await Promise.all(
			rootActivitySummaries.map((summary) =>
				inspectNode(ctx, summary, ACTIVITY_SUMMARY_ATTRS),
			),
		),
	};
};
