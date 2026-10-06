export { RootScope } from "./scope/RootScope";
export {
	ScopeContext,
	RootScopeContext,
	SolidScopeRuntimeContext,
	useRootScope,
	useScope,
	useScopeRuntime,
} from "./context/SolidScopeRuntimeContext";
export type { ScopeAccessor } from "./context/SolidScopeRuntimeContext";
export { createAttrsFor, useAttrs } from "./hooks/useAttrs";
export type { AttrAccessors } from "./hooks/useAttrs";
export { mountShapeFor, useShape } from "./hooks/useShape";
