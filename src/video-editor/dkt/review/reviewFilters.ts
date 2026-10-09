import type { CrdtConflictStatus } from "./types";

/**
 * Status filter of the project review list (`ReviewSession.filters.status`).
 * "unresolved" = open and acknowledged items, "resolved" = resolved items,
 * "all" = every item.
 */
export type ReviewStatusFilter = "unresolved" | "resolved" | "all";

export const REVIEW_STATUS_FILTERS: readonly ReviewStatusFilter[] = [
	"unresolved",
	"resolved",
	"all",
];

export const DEFAULT_REVIEW_STATUS_FILTER: ReviewStatusFilter = "unresolved";

export const asReviewStatusFilter = (value: unknown): ReviewStatusFilter | null =>
	value === "unresolved" || value === "resolved" || value === "all" ? value : null;

/** The status filter stored in a session's `filters` attr (default when unset). */
export const reviewStatusFilterFromFilters = (filters: unknown): ReviewStatusFilter =>
	asReviewStatusFilter(
		filters && typeof filters === "object"
			? (filters as { status?: unknown }).status
			: null,
	) ?? DEFAULT_REVIEW_STATUS_FILTER;

export const reviewStatusMatchesFilter = (
	filter: unknown,
	status: unknown,
): boolean => {
	const resolved = (status as CrdtConflictStatus) === "resolved";
	switch (asReviewStatusFilter(filter) ?? DEFAULT_REVIEW_STATUS_FILTER) {
		case "all":
			return true;
		case "resolved":
			return resolved;
		case "unresolved":
			return !resolved;
	}
};

/** True when an open review item lists the clip among its affected objects. */
export const reviewItemOpenOnClip = (
	clipId: unknown,
	affectedObjects: unknown,
	status: unknown,
): boolean =>
	status === "open" &&
	typeof clipId === "string" &&
	clipId.length > 0 &&
	Array.isArray(affectedObjects) &&
	affectedObjects.some(
		(object) =>
			object != null &&
			typeof object === "object" &&
			(object as { type?: unknown }).type === "clip" &&
			(object as { id?: unknown }).id === clipId,
	);
