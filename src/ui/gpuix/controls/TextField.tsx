import { createEffect, createSignal } from "solid-js";
import { colors, metrics } from "../theme";

/**
 * A single-line text input. `value` is the committed value from the caller; the
 * field shows the text being typed meanwhile and reports every edit through
 * `onInput`. When `value` changes from outside, the field shows it again.
 * Enter and blur call `onCommit`.
 */
export const TextField = (props: {
	value: string;
	onInput: (value: string) => void;
	onCommit?: () => void;
	testId?: string;
	placeholder?: string;
	width?: number;
}) => {
	const [shown, setShown] = createSignal(props.value);
	createEffect(() => setShown(props.value));

	return (
		<input
			testId={props.testId}
			value={shown()}
			placeholder={props.placeholder}
			style={{
				flexGrow: props.width === undefined ? 1 : 0,
				width: props.width,
				minWidth: 0,
				height: 28,
				fontSize: 12,
				color: colors.text,
				backgroundColor: colors.control,
				borderRadius: metrics.radius,
				paddingLeft: 8,
				paddingRight: 8,
			}}
			onChange={(event) => {
				const next = event.value ?? "";
				setShown(next);
				props.onInput(next);
			}}
			onSubmit={() => props.onCommit?.()}
			onBlur={() => props.onCommit?.()}
		/>
	);
};
