import type { JSX } from "solid-js";
import { colors, metrics } from "../theme";

/** A bordered surface with a title bar; the body fills the remaining space. */
export const Panel = (props: {
	title: string;
	testId?: string;
	/** Fixed width, otherwise the panel grows. */
	width?: number;
	height?: number;
	grow?: boolean;
	children: JSX.Element;
}) => (
	<div
		testId={props.testId}
		style={{
			display: "flex",
			flexDirection: "column",
			width: props.width,
			height: props.height,
			flexGrow: props.grow ? 1 : 0,
			flexShrink: props.grow ? 1 : 0,
			minWidth: 0,
			minHeight: 0,
			backgroundColor: colors.panel,
			borderWidth: 1,
			borderColor: colors.border,
			borderRadius: metrics.radius,
			overflow: "hidden",
		}}
	>
		<div
			style={{
				display: "flex",
				alignItems: "center",
				height: metrics.panelHeaderHeight,
				flexShrink: 0,
				paddingLeft: 10,
				backgroundColor: colors.panelHeader,
				color: colors.textMuted,
				fontSize: 12,
				userSelect: "none",
			}}
		>
			<text>{props.title}</text>
		</div>
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				overflow: "hidden",
			}}
		>
			{props.children}
		</div>
	</div>
);
