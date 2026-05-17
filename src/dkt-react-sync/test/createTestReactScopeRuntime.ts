import type { ReactScopeRuntime } from "../runtime/ReactScopeRuntime";
import type { ReactSyncScopeHandle } from "../scope/ScopeHandle";

export const createTestScope = (nodeId: string): ReactSyncScopeHandle => ({
	kind: "scope",
	_nodeId: nodeId,
});

export const createTestReactScopeRuntime = ({
	attrsByNodeId = {},
	relsByNodeId = {},
	rootNodeId = "root",
}: {
	attrsByNodeId?: Record<string, Record<string, unknown>>;
	relsByNodeId?: Record<string, Record<string, string | string[] | null>>;
	rootNodeId?: string;
} = {}): ReactScopeRuntime & {
	dispatchCalls: Array<{
		actionName: string;
		payload: unknown;
		scopeNodeId: string | null;
		meta: unknown;
	}>;
	updateAttrs(nodeId: string, patch: Record<string, unknown>): void;
	updateOne(nodeId: string, relName: string, nodeIdOrNull: string | null): void;
	updateMany(nodeId: string, relName: string, nodeIds: string[]): void;
} => {
	const rootScope = createTestScope(rootNodeId);
	const scopesByNodeId = new Map<string, ReactSyncScopeHandle>([
		[rootNodeId, rootScope],
	]);
	const attrListenersByNodeId = new Map<string, Set<() => void>>();
	const oneListenersByNodeId = new Map<string, Set<() => void>>();
	const manyListenersByNodeId = new Map<string, Set<() => void>>();
	const attrsCache = new Map<string, Record<string, unknown>>();
	const manyCache = new Map<string, readonly ReactSyncScopeHandle[]>();
	const dispatchCalls: Array<{
		actionName: string;
		payload: unknown;
		scopeNodeId: string | null;
		meta: unknown;
	}> = [];
	const scopeDispatchCache = new WeakMap<
		ReactSyncScopeHandle,
		(actionName: string, payload?: unknown, meta?: unknown) => void
	>();

	const getScope = (nodeId: string): ReactSyncScopeHandle => {
		let scope = scopesByNodeId.get(nodeId);
		if (!scope) {
			scope = createTestScope(nodeId);
			scopesByNodeId.set(nodeId, scope);
		}
		return scope;
	};

	const notify = (listeners: Set<() => void> | undefined) => {
		for (const listener of listeners ?? []) {
			listener();
		}
	};

	const subscribeByNode = (
		store: Map<string, Set<() => void>>,
		nodeId: string,
		listener: () => void,
	) => {
		const listeners = store.get(nodeId) ?? new Set<() => void>();
		listeners.add(listener);
		store.set(nodeId, listeners);
		return () => listeners.delete(listener);
	};

	return {
		dispatchCalls,
		getRootScope() {
			return rootScope;
		},
		subscribeRootScope() {
			return () => {};
		},
		readAttrs(scope, attrNames) {
			const cacheKey = `${scope._nodeId}\u001f${attrNames.join("\u001f")}`;
			const attrs = attrsByNodeId[scope._nodeId] ?? {};
			const nextSnapshot = Object.fromEntries(
				attrNames.map((attrName) => [attrName, attrs[attrName]]),
			);
			const cached = attrsCache.get(cacheKey);

			if (
				cached &&
				attrNames.every((attrName) =>
					Object.is(cached[attrName], nextSnapshot[attrName]),
				)
			) {
				return cached;
			}

			attrsCache.set(cacheKey, nextSnapshot);
			return nextSnapshot;
		},
		subscribeAttrs(scope, _attrNames, listener) {
			return subscribeByNode(attrListenersByNodeId, scope._nodeId, listener);
		},
		readOne(scope, relName) {
			const rel = relsByNodeId[scope._nodeId]?.[relName];
			return typeof rel === "string" ? getScope(rel) : null;
		},
		subscribeOne(scope, _relName, listener) {
			return subscribeByNode(oneListenersByNodeId, scope._nodeId, listener);
		},
		readMany(scope, relName) {
			const cacheKey = `${scope._nodeId}\u001f${relName}`;
			const rel = relsByNodeId[scope._nodeId]?.[relName];
			const nodeIds = Array.isArray(rel) ? rel : [];
			const nextSnapshot = Object.freeze(nodeIds.map(getScope));
			const cached = manyCache.get(cacheKey);

			if (
				cached &&
				cached.length === nextSnapshot.length &&
				cached.every(
					(item, index) => item._nodeId === nextSnapshot[index]._nodeId,
				)
			) {
				return cached;
			}

			manyCache.set(cacheKey, nextSnapshot);
			return nextSnapshot;
		},
		subscribeMany(scope, _relName, listener) {
			return subscribeByNode(manyListenersByNodeId, scope._nodeId, listener);
		},
		mountShape() {
			return () => {};
		},
		dispatch(actionName, payload, scope, meta) {
			dispatchCalls.push({
				actionName,
				payload,
				scopeNodeId: scope?._nodeId ?? null,
				meta,
			});
		},
		getDispatch(scope) {
			if (!scope) {
				return (actionName, payload, meta) =>
					this.dispatch(actionName, payload, null, meta);
			}

			let dispatch = scopeDispatchCache.get(scope);
			if (!dispatch) {
				dispatch = (actionName, payload, meta) =>
					this.dispatch(actionName, payload, scope, meta);
				scopeDispatchCache.set(scope, dispatch);
			}

			return dispatch;
		},
		updateAttrs(nodeId, patch) {
			attrsByNodeId[nodeId] = { ...(attrsByNodeId[nodeId] ?? {}), ...patch };
			for (const cacheKey of attrsCache.keys()) {
				if (cacheKey.startsWith(`${nodeId}\u001f`)) {
					attrsCache.delete(cacheKey);
				}
			}
			notify(attrListenersByNodeId.get(nodeId));
		},
		updateOne(nodeId, relName, nodeIdOrNull) {
			relsByNodeId[nodeId] = {
				...(relsByNodeId[nodeId] ?? {}),
				[relName]: nodeIdOrNull,
			};
			notify(oneListenersByNodeId.get(nodeId));
		},
		updateMany(nodeId, relName, nodeIds) {
			relsByNodeId[nodeId] = {
				...(relsByNodeId[nodeId] ?? {}),
				[relName]: nodeIds,
			};
			manyCache.delete(`${nodeId}\u001f${relName}`);
			notify(manyListenersByNodeId.get(nodeId));
		},
	};
};
