const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

export const reduceCreateReviewSession = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{
		reviewSessionId?: unknown;
		projectId?: unknown;
		filters?: unknown;
	}>(payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!projectId) {
		return null;
	}
	const now = Date.now();
	return {
		attrs: {
			reviewSessionId:
				asString(value?.reviewSessionId) ?? `review-session:${projectId}`,
			projectId,
			status: "open",
			selectedReviewItemId: null,
			filters:
				value?.filters && typeof value.filters === "object"
					? value.filters
					: { status: "unresolved" },
			openedAt: now,
			updatedAt: now,
		},
	};
};

export const reduceSelectReviewItem = (payload: unknown) => {
	const value = asObject<{ reviewItemId?: unknown }>(payload);
	const reviewItemId = asString(value?.reviewItemId) ?? asString(payload);
	if (!reviewItemId) {
		return null;
	}
	return {
		selectedReviewItemId: reviewItemId,
		updatedAt: Date.now(),
	};
};

