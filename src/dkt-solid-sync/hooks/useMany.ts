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

const EMPTY_ITEMS = Object.freeze([]) as readonly [];

/**
 * Signal of a many-rel snapshot. The runtime keeps snapshot identity stable
 * while the rel is unchanged, so the signal only notifies on real changes.
 */
export const createManyFor = (
	runtime: ReactScopeRuntime,
	scope: ScopeAccessor,
	rel: string | Accessor<string>,
): Accessor<readonly ReactSyncScopeHandle[]> => {
	const relOf = typeof rel === "function" ? rel : () => rel;
	const read = (currentScope: ReactSyncScopeHandle | null, relName: string) =>
		currentScope ? runtime.readMany(currentScope, relName) : EMPTY_ITEMS;
	const [items, setItems] = createSignal<readonly ReactSyncScopeHandle[]>(
		untrack(() => read(scope(), relOf())),
	);

	mountShapeFor(runtime, scope, () => getRelShape(relOf()));

	createRenderEffect(() => {
		const currentScope = scope();
		const relName = relOf();
		const sync = () => setItems(read(currentScope, relName));

		if (currentScope) {
			onCleanup(runtime.subscribeMany(currentScope, relName, sync));
		}

		sync();
	});

	return items;
};

export const useMany = (rel: string | Accessor<string>) =>
	createManyFor(useScopeRuntime(), useScope(), rel);
