import type { JSX } from "solid-js";
import { useAttrs } from "../../dkt-solid-sync";
import { Panel } from "./controls/Panel";
import { PreviewPanel } from "./preview/PreviewPanel";
import { formatTimecode } from "./preview/syntheticFrameSource";
import { colors, metrics } from "./theme";
import { Toolbar } from "./toolbar/Toolbar";

const Placeholder = (props: { text: string }) => (
	<div style={{ padding: 12 }}>
		<text style={{ color: colors.textMuted, fontSize: 12 }}>{props.text}</text>
	</div>
);

const StatusBar = () => {
	const session = useAttrs(["cursor", "isPlaying"]);
	const cursor = () => {
		const value = session.cursor();
		return typeof value === "number" ? value : 0;
	};

	return (
		<div
			testId="status-bar"
			style={{
				display: "flex",
				alignItems: "center",
				gap: 16,
				height: metrics.statusBarHeight,
				flexShrink: 0,
				paddingLeft: 12,
				backgroundColor: colors.panelHeader,
				borderTopWidth: 1,
				borderColor: colors.border,
				color: colors.textMuted,
				fontSize: 12,
			}}
		>
			<text testId="status-cursor">{formatTimecode(cursor())}</text>
			<text testId="status-playing">
				{session.isPlaying() === true ? "Playing" : "Paused"}
			</text>
		</div>
	);
};

/**
 * Window layout: toolbar on top, sidebar and preview in the middle, timeline
 * at the bottom, status bar last. The sidebar and timeline are slots filled by
 * the project, resource and timeline components.
 */
export const AppShell = (props: {
	sidebar?: JSX.Element;
	timeline?: JSX.Element;
	inspector?: JSX.Element;
}) => (
	<div
		testId="app-shell"
		style={{
			display: "flex",
			flexDirection: "column",
			width: "100%",
			height: "100%",
			backgroundColor: colors.window,
			color: colors.text,
			fontSize: metrics.fontSize,
		}}
	>
		<Toolbar />
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				flexGrow: 1,
				minHeight: 0,
				padding: metrics.gap,
				gap: metrics.gap,
			}}
		>
			<div
				style={{
					display: "flex",
					flexGrow: 1,
					minHeight: 0,
					gap: metrics.gap,
				}}
			>
				<div
					testId="sidebar"
					style={{
						display: "flex",
						flexDirection: "column",
						width: metrics.sidebarWidth,
						flexShrink: 0,
						gap: metrics.gap,
					}}
				>
					{props.sidebar ?? (
						<Panel title="Project" grow>
							<Placeholder text="Projects and resources" />
						</Panel>
					)}
				</div>
				<PreviewPanel />
				{props.inspector}
			</div>
			<div
				testId="timeline-slot"
				style={{
					display: "flex",
					flexDirection: "column",
					height: metrics.timelineHeight,
					flexShrink: 0,
				}}
			>
				{props.timeline ?? (
					<Panel title="Timeline" grow>
						<Placeholder text="Timeline" />
					</Panel>
				)}
			</div>
		</div>
		<StatusBar />
	</div>
);
