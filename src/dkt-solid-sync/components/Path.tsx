import { type JSX, Show } from "solid-js";
import { One } from "./One";

export const Path = (props: {
	rels: readonly string[];
	children: JSX.Element;
	fallback?: JSX.Element;
}) => (
	<Show when={props.rels.length > 0} fallback={props.children}>
		<One rel={props.rels[0]} fallback={props.fallback}>
			<Path rels={props.rels.slice(1)} fallback={props.fallback}>
				{props.children}
			</Path>
		</One>
	</Show>
);
