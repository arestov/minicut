import type React from "react";
import { useEffect, useSyncExternalStore } from "react";
import type { PageSyncRuntime } from "../../../dkt-react-sync/runtime/PageSyncRuntime";
import { RootScope } from "../../../dkt-react-sync/scope/RootScope";
import {
	WORKSPACE_OPEN_STATUS,
	getWorkspaceOpenFailureLabel,
	type WorkspaceOpenFailure,
} from "../../dkt/runtime/workspaceOpenState";
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
	const runtimeSnapshot = useSyncExternalStore(
		runtime?.subscribe.bind(runtime) ?? (() => () => {}),
		runtime?.getSnapshot.bind(runtime) ?? (() => null),
		runtime?.getSnapshot.bind(runtime) ?? (() => null),
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

	if (
		runtimeSnapshot?.workspaceOpenState?.status ===
		WORKSPACE_OPEN_STATUS.FAILED
	) {
		const failureReason = runtimeSnapshot.workspaceOpenState
			.failureReason as WorkspaceOpenFailure;
		return (
			<div className="ve-shell ve-shell--status">
				<div className="crdt-harness-notice crdt-harness-notice--error" role="alert">
					<strong>Workspace storage open failed</strong>
					<span>{getWorkspaceOpenFailureLabel(failureReason)}</span>
					{runtimeSnapshot.runtimeError ? (
						<span>{runtimeSnapshot.runtimeError}</span>
					) : null}
				</div>
			</div>
		);
	}

	return <RootScope runtime={runtime}>{children}</RootScope>;
};
