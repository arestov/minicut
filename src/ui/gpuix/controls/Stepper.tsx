import { colors } from "../theme";
import { Button } from "./Button";

/**
 * A labelled value with decrement and increment buttons. The value is
 * already formatted by the caller; the buttons only report the direction.
 */
export const Stepper = (props: {
	label: string;
	value: string;
	testId: string;
	onDecrement: () => void;
	onIncrement: () => void;
	decrementDisabled?: boolean;
	incrementDisabled?: boolean;
}) => (
	<div
		style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, height: 28 }}
	>
		<text style={{ color: colors.textMuted, fontSize: 12, width: 64 }}>{props.label}</text>
		<Button
			testId={`${props.testId}-dec`}
			aria-label={`Decrease ${props.label}`}
			disabled={props.decrementDisabled}
			onClick={props.onDecrement}
		>
			<text>-</text>
		</Button>
		<text
			testId={`${props.testId}-value`}
			style={{ color: colors.text, fontSize: 12, width: 56, textAlign: "center" }}
		>
			{props.value}
		</text>
		<Button
			testId={`${props.testId}-inc`}
			aria-label={`Increase ${props.label}`}
			disabled={props.incrementDisabled}
			onClick={props.onIncrement}
		>
			<text>+</text>
		</Button>
	</div>
);
