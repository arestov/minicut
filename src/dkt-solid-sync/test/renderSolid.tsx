import type { JSX } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";
import { RootScope } from "../scope/RootScope";

/**
 * Renders inside RootScope on the native TestRenderer. Mutations of the
 * runtime must go through `flushSync` so the renderer applies the batch.
 */
export const renderInRootScope = (
	runtime: ReactScopeRuntime,
	code: () => JSX.Element,
) => {
	const root = createTestRoot();

	root.render(() => <RootScope runtime={runtime}>{code()}</RootScope>);

	return {
		...root,
		texts: () => root.renderer.getAllText(),
	};
};
