import { Button } from "./ControlPrimitives";

export type FramePaletteStatus = "idle" | "frame" | "fallback" | "unavailable";

const framePaletteStatusLabel: Record<FramePaletteStatus, string> = {
	idle: "Palette ready",
	frame: "Frame palette",
	fallback: "Fallback palette",
	unavailable: "No frame palette",
};

export const FramePaletteAction = ({
	status,
	onGenerate,
}: {
	status: FramePaletteStatus;
	onGenerate: () => void;
}) => (
	<div className="ve-text-color-feedback" aria-label="Frame palette feedback">
		<span className="ve-status-pill">{framePaletteStatusLabel[status]}</span>
		<Button type="button" variant="secondary" onClick={onGenerate}>
			Generate palette from frame
		</Button>
	</div>
);
