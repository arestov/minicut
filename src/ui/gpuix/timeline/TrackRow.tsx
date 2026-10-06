import { Many, useAttrs } from "../../../dkt-solid-sync";
import { colors } from "../theme";
import { ClipView } from "./ClipView";
import {
	DEFAULT_ROW_HEIGHT,
	HEADER_WIDTH,
	useTimelineView,
} from "./timelineView";

/** One track: a frozen header cell and a lane holding the track's clips. */
export const TrackRow = () => {
	const view = useTimelineView();
	const attrs = useAttrs(["name", "kind", "height"]);
	const height = () => {
		const value = attrs.height();
		return typeof value === "number" && value > 0 ? value : DEFAULT_ROW_HEIGHT;
	};

	return (
		<div
			testId="track-row"
			style={{
				display: "flex",
				flexDirection: "row",
				height: height(),
				flexShrink: 0,
				borderBottomWidth: 1,
				borderColor: colors.border,
			}}
		>
			<div
				testId="track-header"
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					gap: 2,
					width: HEADER_WIDTH,
					flexShrink: 0,
					paddingLeft: 10,
					backgroundColor: colors.panelHeader,
					borderRightWidth: 1,
					borderColor: colors.border,
					userSelect: "none",
				}}
			>
				<text style={{ color: colors.text, fontSize: 12 }}>{String(attrs.name())}</text>
				<text style={{ color: colors.textMuted, fontSize: 10 }}>{String(attrs.kind())}</text>
			</div>
			<div
				testId="track-lane"
				style={{
					position: "relative",
					flexGrow: 1,
					minWidth: 0,
					overflow: "hidden",
					backgroundColor: colors.window,
				}}
			>
				<div
					style={{
						position: "absolute",
						left: -view.scrollX(),
						top: 0,
						bottom: 0,
						width: 1,
					}}
				>
					<Many rel="clips" item={ClipView} readyAttr="duration" />
				</div>
			</div>
		</div>
	);
};
