import { useAttrs } from "../../../dkt-solid-sync";
import { Panel } from "../controls/Panel";
import { colors } from "../theme";
import { FramePresenter } from "./FramePresenter";
import { createSyntheticPreviewSource, formatTimecode } from "./syntheticFrameSource";

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 270;

/** Preview of the frame at the session cursor (synthetic frames for now). */
export const PreviewPanel = () => {
	const session = useAttrs(["cursor"]);
	const source = createSyntheticPreviewSource({
		width: PREVIEW_WIDTH,
		height: PREVIEW_HEIGHT,
	});
	const cursor = () => {
		const value = session.cursor();
		return typeof value === "number" ? value : 0;
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
			</div>
		</Panel>
	);
};
