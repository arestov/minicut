import {
	type Accessor,
	createRenderEffect,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";
import { getRelShape } from "../../dkt-ui-sync/shape/autoShapes";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import { useScope, useScopeRuntime } from "../context/SolidScopeRuntimeContext";
import type { ScopeAccessor } from "../context/SolidScopeRuntimeContext";
import { mountShapeFor } from "./useShape";

/**
 * Signal of a one-rel target. Shape demand for the rel is registered on
 * creation; the runtime subscription is replaced when the scope changes and
 * dropped in `onCleanup`.
 */
export const createOneFor = (
	runtime: ReactScopeRuntime,
	scope: ScopeAccessor,
	rel: string | Accessor<string>,
): Accessor<ReactSyncScopeHandle | null> => {
	const relOf = typeof rel === "function" ? rel : () => rel;
	const read = (currentScope: ReactSyncScopeHandle | null, relName: string) =>
		currentScope ? runtime.readOne(currentScope, relName) : null;
	const [child, setChild] = createSignal<ReactSyncScopeHandle | null>(
		untrack(() => read(scope(), relOf())),
	);

	mountShapeFor(runtime, scope, () => getRelShape(relOf()));

	createRenderEffect(() => {
		const currentScope = scope();
		const relName = relOf();
		const sync = () => setChild(read(currentScope, relName));

		if (currentScope) {
			onCleanup(runtime.subscribeOne(currentScope, relName, sync));
		}

		sync();
	});

	return child;
};

export const useOne = (rel: string | Accessor<string>) =>
	createOneFor(useScopeRuntime(), useScope(), rel);
