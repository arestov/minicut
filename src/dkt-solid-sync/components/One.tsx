import { type JSX, Show } from "solid-js";
import { ScopeContext } from "../context/SolidScopeRuntimeContext";
import { useOne } from "../hooks/useOne";
import { ReadyGate } from "./ReadyGate";

export const One = (props: {
	rel: string;
	children: JSX.Element;
	fallback?: JSX.Element;
	/**
	 * When provided, the child is withheld until this attr is non-null on the
	 * resolved child scope (i.e. the worker has streamed that attr).
	 */
	readyAttr?: string;
}) => {
	const child = useOne(() => props.rel);

	return (
		<Show when={child()} fallback={props.fallback}>
			<ScopeContext.Provider value={child}>
				<Show when={props.readyAttr} keyed fallback={props.children}>
					{(attrName) => (
						<ReadyGate attrName={attrName} fallback={props.fallback}>
							{props.children}
						</ReadyGate>
					)}
				</Show>
			</ScopeContext.Provider>
		</Show>
	);
};
