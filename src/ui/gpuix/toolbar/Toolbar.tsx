import { Show } from "solid-js";
import { One, useAttrs, useRootDispatch } from "../../../dkt-solid-sync";
import {
	TIMELINE_ZOOM_MAX,
	TIMELINE_ZOOM_MIN,
	TIMELINE_ZOOM_STEP,
} from "../../../video-editor/models/sessionZoom";
import { Button } from "../controls/Button";
import { useHostServices } from "../host/hostServices";
import { colors, metrics } from "../theme";

const ProjectTitle = () => {
	const attrs = useAttrs(["title"]);
	return (
		<text testId="project-title" style={{ color: colors.text, fontSize: 14, fontWeight: 600 }}>
			{String(attrs.title())}
		</text>
	);
};

/**
 * Session toolbar. Reads the active project title and the timeline zoom
 * through the scope runtime; zoom and new-project go back as model actions.
 */
export const Toolbar = () => {
	const dispatch = useRootDispatch();
	const host = useHostServices();
	const session = useAttrs(["timelineZoom"]);
	const zoom = () => {
		const value = session.timelineZoom();
		return typeof value === "number" ? value : null;
	};

	return (
		<div
			testId="toolbar"
			style={{
				display: "flex",
				alignItems: "center",
				gap: metrics.gap,
				height: metrics.toolbarHeight,
				flexShrink: 0,
				paddingLeft: 12,
				paddingRight: 12,
				backgroundColor: colors.panelHeader,
				borderBottomWidth: 1,
				borderColor: colors.border,
			}}
		>
			<One
				rel="activeProject"
				readyAttr="title"
				fallback={<text style={{ color: colors.textMuted }}>No project</text>}
			>
				<ProjectTitle />
			</One>
			<div style={{ flexGrow: 1 }} />
			<Show when={host}>
				{(services) => (
					<Button
						testId="import-media"
						aria-label="Import media"
						onClick={() => void services().importFromDialog()}
					>
						<text>Import media</text>
					</Button>
				)}
			</Show>
			<Button testId="new-project" onClick={() => dispatch("createProject", {})}>
				<text>New project</text>
			</Button>
			<Button
				testId="zoom-out"
				aria-label="Zoom out"
				disabled={zoom() === null || (zoom() ?? 0) <= TIMELINE_ZOOM_MIN}
				onClick={() => dispatch("zoomTimeline", -TIMELINE_ZOOM_STEP)}
			>
				<text>-</text>
			</Button>
			<text testId="zoom-value" style={{ color: colors.textMuted, fontSize: 12, minWidth: 40, textAlign: "center" }}>
				{zoom() === null ? "--" : `${zoom()} px/s`}
			</text>
			<Button
				testId="zoom-in"
				aria-label="Zoom in"
				disabled={zoom() === null || (zoom() ?? 0) >= TIMELINE_ZOOM_MAX}
				onClick={() => dispatch("zoomTimeline", TIMELINE_ZOOM_STEP)}
			>
				<text>+</text>
			</Button>
		</div>
	);
};
