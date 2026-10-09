import { For } from "solid-js";
import { Button } from "./Button";

/** A row of mutually exclusive choices; the selected one is highlighted. */
export const Segmented = <Value extends string>(props: {
	options: ReadonlyArray<{ value: Value; label: string }>;
	value: Value;
	onChange: (value: Value) => void;
	/** Option buttons get `${testId}-${value}`. */
	testId?: string;
}) => (
	<div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
		<For each={props.options}>
			{(option) => (
				<Button
					testId={props.testId ? `${props.testId}-${option.value}` : undefined}
					aria-label={option.label}
					active={props.value === option.value}
					onClick={() => props.onChange(option.value)}
				>
					<text>{option.label}</text>
				</Button>
			)}
		</For>
	</div>
);
