import { useReactScopeRuntime } from "./useReactScopeRuntime";
import { useScope } from "./useScope";

export const useActions = () => {
	const runtime = useReactScopeRuntime();
	const scope = useScope();

	return runtime.getDispatch(scope);
};
