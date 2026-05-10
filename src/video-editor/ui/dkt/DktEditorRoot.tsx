import type React from "react";
import { useEffect, useSyncExternalStore } from "react";
import type { PageSyncRuntime } from "../../../dkt-react-sync/runtime/PageSyncRuntime";
import { RootScope } from "../../../dkt-react-sync/scope/RootScope";
import { miniCutEditorRootShape } from "./shapes";

const DEFAULT_BOOTSTRAP_OPTIONS = { sessionKey: "minicut-local" };

export const DktEditorRoot = ({
	runtime,
	bootstrapOptions = DEFAULT_BOOTSTRAP_OPTIONS,
	children,
}: {
	runtime: PageSyncRuntime | null;
	bootstrapOptions?: Parameters<PageSyncRuntime["bootstrap"]>[0] | null;
	children: React.ReactNode;
}) => {
	useEffect(() => {
		if (bootstrapOptions === null) {
			return;
		}

		runtime?.bootstrap(bootstrapOptions);
	}, [runtime, bootstrapOptions]);

	const rootScope = useSyncExternalStore(
		runtime?.subscribeRootScope.bind(runtime) ?? (() => () => {}),
		runtime?.getRootScope.bind(runtime) ?? (() => null),
		runtime?.getRootScope.bind(runtime) ?? (() => null),
	);

	useEffect(() => {
		if (!runtime || !rootScope) {
			return undefined;
		}

		return runtime.mountShape(rootScope, miniCutEditorRootShape);
	}, [runtime, rootScope]);

	if (!runtime) {
		return <>{children}</>;
	}

	return <RootScope runtime={runtime}>{children}</RootScope>;
};
