import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { getAttrsShape } from "../shape/autoShapes";
import { useReactScopeRuntime } from "./useReactScopeRuntime";

const normalizeFields = (fields: readonly string[]) =>
	Array.from(new Set(fields)).sort();
const EMPTY_ATTRS = Object.freeze({}) as Record<string, unknown>;

/**
 * Like useAttrs, but always reads from the root (session) scope regardless of
 * the current ScopeContext. Use this inside <One rel="activeProject"> subtrees
 * where the local scope is a project but you still need session-level attrs.
 */
export const useRootAttrs = (
	fields: readonly string[],
): Record<string, unknown> => {
	const runtime = useReactScopeRuntime();
	const normalizedFields = useMemo(() => normalizeFields(fields), [fields]);

	const rootScope = useSyncExternalStore(
		runtime.subscribeRootScope.bind(runtime),
		runtime.getRootScope.bind(runtime),
		runtime.getRootScope.bind(runtime),
	);

	// Mount shape on the ROOT scope so DKT's doesAttrMatchNodeShape passes for
	// the session root node. Using useShape() would mount on the current scope
	// (which may be a project scope inside ActiveProjectScope), causing computed
	// attrs like previewFrame/previewStructure to be filtered out of the sync stream.
	const shape = getAttrsShape(normalizedFields);
	useEffect(() => {
		if (!shape || !rootScope) return;
		return runtime.mountShape(rootScope, shape);
	}, [runtime, rootScope, shape]);

	const subscribe = useCallback(
		(listener: () => void) =>
			rootScope
				? runtime.subscribeAttrs(rootScope, normalizedFields, listener)
				: () => {},
		[runtime, rootScope, normalizedFields],
	);

	const getSnapshot = useCallback(
		() =>
			rootScope ? runtime.readAttrs(rootScope, normalizedFields) : EMPTY_ATTRS,
		[runtime, rootScope, normalizedFields],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
