import { type Component, type JSX, For, Show, createMemo } from "solid-js";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import { ScopeContext } from "../context/SolidScopeRuntimeContext";
import { useMany } from "../hooks/useMany";
import { ReadyGate } from "./ReadyGate";

const sameIds = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((id, index) => id === b[index]);

export const Many = (props: {
	rel: string;
	item: Component;
	empty?: JSX.Element;
	limit?: number;
	/**
	 * When provided, each item is withheld from rendering until this attr
	 * arrives from the worker (i.e. is non-null).
	 */
	readyAttr?: string;
}) => {
	const items = useMany(() => props.rel);
	const Item = props.item;
	const visible = createMemo(() => {
		const all = items();

		return typeof props.limit === "number"
			? all.slice(0, Math.max(0, props.limit))
			: all;
	});
	// Rows are keyed by `_nodeId`: a rel update that keeps an id keeps its row
	// (and its subscriptions), whatever handle object the runtime returns.
	const ids = createMemo(() => visible().map((scope) => scope._nodeId), [], {
		equals: sameIds,
	});
	const scopesById = createMemo(
		() => new Map(visible().map((scope) => [scope._nodeId, scope])),
	);

	return (
		<Show when={ids().length > 0} fallback={props.empty}>
			<For each={ids()}>
				{(id) => {
					let last = scopesById().get(id) as ReactSyncScopeHandle;
					const scope = createMemo(() => {
						last = scopesById().get(id) ?? last;
						return last;
					});

					return (
						<ScopeContext.Provider value={scope}>
							<Show when={props.readyAttr} keyed fallback={<Item />}>
								{(attrName) => (
									<ReadyGate attrName={attrName}>
										<Item />
									</ReadyGate>
								)}
							</Show>
						</ScopeContext.Provider>
					);
				}}
			</For>
		</Show>
	);
};
