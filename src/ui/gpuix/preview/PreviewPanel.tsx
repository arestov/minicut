import { createEffect, onCleanup, Show } from "solid-js";
import { One, useAttrs, useScope } from "../../../dkt-solid-sync";
import { Panel } from "../controls/Panel";
import { type PreviewHostService, useHostServices } from "../host/hostServices";
import { colors } from "../theme";
import { FramePresenter } from "./FramePresenter";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./previewSize";
import {
	createSyntheticPreviewSource,
	formatTimecode,
} from "./syntheticFrameSource";

/**
 * Hands the model's plan inputs (declared attrs of the active project and the
 * session `previewStructure`) to the host preview service. It only forwards
 * values; the host resolves files and builds the producer source.
 */
const PreviewPlanFeed = (props: {
	preview: PreviewHostService;
	structure: () => unknown;
}) => {
	const project = useAttrs(["fps", "width", "height", "duration"]);
	const scope = useScope();
	createEffect(() => {
		const structure = props.structure() as { clipSources?: unknown } | null;
		props.preview.updatePlan({
			projectId: scope()?._nodeId ?? "",
			fps: Number(project.fps()),
			width: Number(project.width()),
			height: Number(project.height()),
			duration: Number(project.duration()),
			clipSources: Array.isArray(structure?.clipSources)
				? (structure.clipSources as never)
				: [],
		});
	});
	onCleanup(() => props.preview.updatePlan(null));
	return null;
};

/**
 * Preview of the frame at the session cursor: Node frames when the host
 * provides a preview service, synthetic frames on fixture hosts.
 */
export const PreviewPanel = () => {
	const host = useHostServices();
	const session = useAttrs(["cursor", "previewStructure"]);
	const preview = host?.preview;
	const source =
		preview?.source ??
		createSyntheticPreviewSource({
			width: PREVIEW_WIDTH,
			height: PREVIEW_HEIGHT,
		});
	const committed = () => {
		const value = session.cursor();
		return typeof value === "number" ? value : 0;
	};
	// While a run is playing (or scrubbing) the presentation time leads; at rest the model cursor.
	const cursor = () => {
		const playback = host?.playback?.();
		return playback && (playback.isPlaying || playback.isScrubbing)
			? playback.presentationTime
			: committed();
	};

	return (
		<Panel title="Preview" testId="preview-panel" grow>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					alignItems: "center",
					justifyContent: "center",
					gap: 8,
					backgroundColor: colors.window,
				}}
			>
				<FramePresenter testId="preview-frame" source={source} time={cursor} />
				<text testId="preview-timecode" style={{ color: colors.textMuted, fontSize: 12 }}>
					{formatTimecode(cursor())}
				</text>
				<Show when={preview}>
					{(service) => (
						<>
							<One rel="activeProject" readyAttr="fps">
								<PreviewPlanFeed
									preview={service()}
									structure={session.previewStructure}
								/>
							</One>
							<Show when={service().notice()}>
								{(message) => (
									<text
										testId="preview-notice"
										style={{ color: "#f59e0b", fontSize: 11 }}
									>
										{message()}
									</text>
								)}
							</Show>
						</>
					)}
				</Show>
			</div>
		</Panel>
	);
};
