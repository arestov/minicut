import type { JSX } from "solid-js";
import { Button } from "../controls/Button";
import { colors } from "../theme";

/** A wrapping row of action buttons. */
export const ActionRow = (props: { children: JSX.Element }) => (
	<div style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
		{props.children}
	</div>
);

export const ActionButton = (props: {
	label: string;
	testId: string;
	onClick: () => void;
	disabled?: boolean;
}) => (
	<Button
		testId={props.testId}
		aria-label={props.label}
		disabled={props.disabled}
		onClick={props.onClick}
	>
		<text>{props.label}</text>
	</Button>
);

export const MutedText = (props: { children: string; testId?: string }) => (
	<text testId={props.testId} style={{ color: colors.textMuted, fontSize: 12 }}>
		{props.children}
	</text>
);

/** A bordered group inside the inspector (variant columns, order lists). */
export const Group = (props: { children: JSX.Element; grow?: boolean }) => (
	<div
		style={{
			display: "flex",
			flexDirection: "column",
			gap: 4,
			padding: 8,
			flexGrow: props.grow ? 1 : 0,
			flexShrink: 0,
			minWidth: 0,
			borderWidth: 1,
			borderColor: colors.border,
			borderRadius: 6,
		}}
	>
		{props.children}
	</div>
);
