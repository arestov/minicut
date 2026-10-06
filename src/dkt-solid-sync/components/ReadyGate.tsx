import { type JSX, Show } from "solid-js";
import { useAttrs } from "../hooks/useAttrs";

/**
 * Withholds children until the attr is non-null on the current scope, i.e.
 * until it has arrived from the worker. `attrName` is read once; callers key
 * the gate on it (One/Many use a keyed `Show`) so a change recreates the gate.
 */
export const ReadyGate = (props: {
	attrName: string;
	fallback?: JSX.Element;
	children: JSX.Element;
}) => {
	const attrs = useAttrs([props.attrName]);

	return (
		<Show when={attrs[props.attrName]() != null} fallback={props.fallback}>
			{props.children}
		</Show>
	);
};
