/**
 * Returns `true` while the current DKT scope is in a "skeleton" state:
 * the node is already present in a relation (scope is non-null) but one or
 * more of the requested attrs have not yet arrived from the worker.
 *
 * Typical use-case: prevent rendering positional/dimensional clip attrs
 * that default to 0 until the worker streams the real values.
 *
 * ```tsx
 * const isPartial = useIsAttrsPartial(['start', 'duration'])
 * if (isPartial) return null  // or <SkeletonClip />
 * ```
 */
import { useAttrs } from "./useAttrs";
import { useScope } from "./useScope";

export const useIsAttrsPartial = (fields: readonly string[]): boolean => {
	const scope = useScope();
	const attrs = useAttrs(fields);

	// If there is no scope the element isn't mounted yet — not a skeleton.
	if (!scope) {
		return false;
	}

	return fields.some((field) => attrs[field] == null);
};
