import { useSyncExternalStore } from "react";
import { getRelShape } from "../shape/autoShapes";
import { useReactScopeRuntime } from "./useReactScopeRuntime";
import { useScope } from "./useScope";
import { useShape } from "./useShape";

export const useOne = (rel: string) => {
	const runtime = useReactScopeRuntime();
	const scope = useScope();
	const shape = getRelShape(rel);

	useShape(shape);

	return useSyncExternalStore(
		(listener) =>
			scope ? runtime.subscribeOne(scope, rel, listener) : () => {},
		() => (scope ? runtime.readOne(scope, rel) : null),
		() => (scope ? runtime.readOne(scope, rel) : null),
	);
};
