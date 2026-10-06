import { type JSX, createSignal, onCleanup } from "solid-js";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";
import {
	RootScopeContext,
	ScopeContext,
	SolidScopeRuntimeContext,
} from "../context/SolidScopeRuntimeContext";

export const RootScope = (props: {
	runtime: ReactScopeRuntime;
	children: JSX.Element;
}) => {
	const runtime = props.runtime;
	const [rootScope, setRootScope] = createSignal(runtime.getRootScope());
	const sync = () => setRootScope(runtime.getRootScope());

	onCleanup(runtime.subscribeRootScope(sync));
	sync();

	return (
		<SolidScopeRuntimeContext.Provider value={runtime}>
			<RootScopeContext.Provider value={rootScope}>
				<ScopeContext.Provider value={rootScope}>
					{props.children}
				</ScopeContext.Provider>
			</RootScopeContext.Provider>
		</SolidScopeRuntimeContext.Provider>
	);
};
