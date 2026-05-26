import type {
	MiniCutReviewActionTarget,
	MiniCutReviewItem,
} from "../types";
import type {
	HeadlessDktModel,
	HeadlessReviewPeer,
} from "./createHeadlessReviewPair";

const rootRelByTargetType: Record<MiniCutReviewActionTarget["type"], string> = {
	project: "project",
	clip: "clip",
	resource: "resource",
};

export const findModelByNodeId = async (
	peer: HeadlessReviewPeer,
	target: MiniCutReviewActionTarget,
): Promise<HeadlessDktModel | null> => {
	const rootRel = rootRelByTargetType[target.type];
	const models = await peer.ctx.queryRel(peer.ctx.appModel, rootRel);
	return (
		(models as HeadlessDktModel[]).find(
			(model) => model._node_id === target.id,
		) ?? null
	);
};

export const dispatchReviewActionLikeUi = async (
	peer: HeadlessReviewPeer,
	item: MiniCutReviewItem,
	actionId: string,
	payload: unknown = {},
) => {
	const target = item.actionTargets[actionId];
	if (!target) {
		throw new Error(`Review action ${actionId} has no action target`);
	}
	const scope = await findModelByNodeId(peer, target);
	if (!scope) {
		throw new Error(
			`Review action target ${target.type}:${target.id} is not loaded`,
		);
	}
	await peer.dispatch(scope, actionId, {
		conflict_id: item.conflictId,
		review_item_id: item.id,
		...(payload && typeof payload === "object"
			? (payload as Record<string, unknown>)
			: {}),
	});
};

export const acknowledgeReviewItemLikeUi = async (
	peer: HeadlessReviewPeer,
	item: MiniCutReviewItem,
) => {
	await peer.dispatch(peer.ctx.appModel, "acknowledgeReviewItem", {
		conflict_id: item.conflictId,
		review_item_id: item.id,
	});
};