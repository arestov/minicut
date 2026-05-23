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

export type ProjectReviewGraphSnapshot = ReviewGraphSnapshot & {
	project: ReviewGraphNodeSnapshot;
	items: ReviewGraphNodeSnapshot[];
	activitySummaries: ReviewGraphNodeSnapshot[];
	openItemCount: number;
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

const ROOT_ATTRS = ["activeReviewItemId"] as const;

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
	const isProjectRoot = modelName(root) === "project";
	const [reviewSessions, rootReviewItems, rootActivitySummaries] =
		await Promise.all([
			ctx.queryRel(root, isProjectRoot ? "reviewSessions" : "reviewSession"),
			ctx.queryRel(root, isProjectRoot ? "reviewItems" : "reviewItem"),
			isProjectRoot ? Promise.resolve([]) : ctx.queryRel(root, "activitySummary"),
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

const flattenSessionItems = (
	sessions: ReviewGraphSessionSnapshot[],
): ReviewGraphNodeSnapshot[] =>
	sessions.flatMap((session) => session.items);

const flattenSessionActivitySummaries = (
	sessions: ReviewGraphSessionSnapshot[],
): ReviewGraphNodeSnapshot[] =>
	sessions.flatMap((session) => session.activitySummaries);

export const inspectProjectReviewGraph = async (
	ctx: DktTestContext,
	project: DktModel,
): Promise<ProjectReviewGraphSnapshot> => {
	const graph = await inspectReviewGraph(ctx, ctx.appModel);
	const projectGraph = await inspectReviewGraph(ctx, project);
	const items = projectGraph.rootReviewItems;
	const activitySummaries = projectGraph.rootActivitySummaries;
	const reviewSessions = projectGraph.reviewSessions;
	return {
		...graph,
		reviewSessions,
		project: await inspectNode(ctx, project, ["projectReviewSnapshot"]),
		items,
		activitySummaries,
		openItemCount: items.filter((item) => item.attrs.status !== "resolved").length,
	};
};

export const waitForProjectReviewGraph = async (
	ctx: DktTestContext,
	project: DktModel,
	predicate: (graph: ProjectReviewGraphSnapshot) => boolean,
	options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ProjectReviewGraphSnapshot> => {
	const timeoutMs = options.timeoutMs ?? 5_000;
	const intervalMs = options.intervalMs ?? 25;
	const deadline = Date.now() + timeoutMs;
	let lastGraph = await inspectProjectReviewGraph(ctx, project);
	while (Date.now() <= deadline) {
		await ctx.computed();
		lastGraph = await inspectProjectReviewGraph(ctx, project);
		if (predicate(lastGraph)) {
			return lastGraph;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(
		`Timed out waiting for project review graph: ${JSON.stringify(lastGraph, null, 2)}`,
	);
};
