import { createEffect, createSignal, on, untrack } from "solid-js";
import { TextField } from "./TextField";

/**
 * A text field for a finite number. `onChange` fires for every edit that
 * parses to a finite number; text that does not parse (empty, "-", "1e") is
 * kept as typed and does not change the value. When `value` changes from
 * outside to something the text no longer shows, the text follows it.
 */
export const NumberField = (props: {
	value: number;
	onChange: (value: number) => void;
	testId?: string;
	width?: number;
}) => {
	const [text, setText] = createSignal(String(props.value));
	createEffect(
		on(
			() => props.value,
			(value) => {
				if (Number(untrack(text)) !== value) setText(String(value));
			},
			{ defer: true },
		),
	);

	return (
		<TextField
			testId={props.testId}
			width={props.width}
			value={text()}
			onInput={(next) => {
				setText(next);
				const parsed = Number(next);
				if (next.trim() !== "" && Number.isFinite(parsed)) props.onChange(parsed);
			}}
		/>
	);
};
