import { useSyncExternalStore } from "react";
import { ScopeContext } from "../context/ScopeContext";
import { useAttrs } from "../hooks/useAttrs";
import { useReactScopeRuntime } from "../hooks/useReactScopeRuntime";
import { useScope } from "../hooks/useScope";
import { useShape } from "../hooks/useShape";
import { getRelShape } from "../shape/autoShapes";

/**
 * Gates rendering of the child until a specific attr arrives on the child scope.
 * Mounted inside the child ScopeContext so useAttrs reads the right scope.
 */
const ReadyGate = ({
	attrName,
	children,
	fallback,
}: {
	attrName: string;
	children: React.ReactNode;
	fallback: React.ReactNode;
}) => {
	const attrs = useAttrs([attrName]);
	return attrs[attrName] != null ? children : fallback;
};

export const One = ({
	rel,
	children,
	fallback = null,
	readyAttr,
}: {
	rel: string;
	children: React.ReactNode;
	fallback?: React.ReactNode;
	/**
	 * When provided, the child is withheld until this attr is non-null on the
	 * resolved child scope (i.e. the worker has streamed that attr).
	 */
	readyAttr?: string;
}) => {
	const runtime = useReactScopeRuntime();
	const scope = useScope();
	const shape = getRelShape(rel);

	useShape(shape);

	const childScope = useSyncExternalStore(
		(listener) =>
			scope ? runtime.subscribeOne(scope, rel, listener) : () => {},
		() => (scope ? runtime.readOne(scope, rel) : null),
		() => (scope ? runtime.readOne(scope, rel) : null),
	);

	if (!scope || !childScope) {
		return <>{fallback}</>;
	}

	return (
		<ScopeContext.Provider value={childScope}>
			{readyAttr ? (
				<ReadyGate attrName={readyAttr} fallback={fallback}>
					{children}
				</ReadyGate>
			) : (
				children
			)}
		</ScopeContext.Provider>
	);
};
