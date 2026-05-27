export const crdtReviewResolveTarget = "$crdt:resolve" as const;
export const crdtReviewResolveBatchTarget = "$crdt:resolve_batch" as const;
export const crdtReviewAcknowledgeTarget = "$crdt:acknowledge" as const;
export const crdtReviewClearResolutionAttemptTarget =
	"$crdt:clear_resolution_attempt" as const;

export type MiniCutCrdtDecisionInput = {
	conflictId: string;
	reviewItemId: string;
	action: string;
	domainResult: unknown;
	decisionId?: string;
};

const requireNonEmptyString = (value: string, name: string): string => {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`MiniCut CRDT review command requires ${name}`);
	}
	return value;
};

export const makeCrdtResolvePayload = (input: MiniCutCrdtDecisionInput) => {
	const conflictId = requireNonEmptyString(input.conflictId, "conflictId");
	const reviewItemId = requireNonEmptyString(input.reviewItemId, "reviewItemId");
	const action = requireNonEmptyString(input.action, "action");
	return {
		conflict_id: conflictId,
		decision: {
			app: "minicut",
			decision_id:
				input.decisionId ?? `${action}:${reviewItemId}:${conflictId}`,
			action,
			review_item_id: reviewItemId,
			domain_result: input.domainResult,
		},
	};
};

export const makeCrdtResolveBatchPayload = (
	inputs: MiniCutCrdtDecisionInput[],
) => ({
	atomic: true,
	decisions: inputs.map((input) => ({
		conflict_id: requireNonEmptyString(input.conflictId, "conflictId"),
		decision: makeCrdtResolvePayload(input).decision,
	})),
});

export const makeCrdtAcknowledgePayload = (input: {
	conflictId: string;
	reviewItemId: string;
	action: string;
}) => ({
	conflict_id: requireNonEmptyString(input.conflictId, "conflictId"),
	actor: "minicut",
	review_item_id: requireNonEmptyString(input.reviewItemId, "reviewItemId"),
	action: requireNonEmptyString(input.action, "action"),
});
