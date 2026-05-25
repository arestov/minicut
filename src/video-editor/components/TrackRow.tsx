import { Eye, EyeOff, Lock, Volume2 } from "lucide-react";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { useActions } from "../../dkt-react-sync/hooks/useActions";
import { useAttrs } from "../../dkt-react-sync/hooks/useAttrs";
import { useMany } from "../../dkt-react-sync/hooks/useMany";
import { ClipItem } from "./ClipItem";
import { IconButton } from "./ControlPrimitives";

interface TrackRowProps {
	timelineZoom: number;
	activeTool: "select" | "trim" | "split" | "hand";
	selectedEntityId: string | null;
}

interface TrackRenderAttrs {
	name?: unknown;
	kind?: unknown;
	muted?: unknown;
	locked?: unknown;
	enabled?: unknown;
	visibleInPreview?: unknown;
	trackRole?: unknown;
}

export const TrackLabel = () => {
	const dispatch = useActions();
	const trackAttrs = useAttrs([
		"name",
		"kind",
		"muted",
		"locked",
		"enabled",
		"visibleInPreview",
		"trackRole",
	]) as TrackRenderAttrs;
	const trackName = String(trackAttrs.name);
	const trackKind = String(trackAttrs.kind);
	const isMuted = Boolean(trackAttrs.muted);
	const isLocked = Boolean(trackAttrs.locked);
	const isPreviewEnabled =
		trackAttrs.enabled !== false && trackAttrs.visibleInPreview !== false;
	const roleLabel =
		trackAttrs.trackRole === "incomingReview"
			? "Incoming Review"
			: trackAttrs.trackRole === "currentReview"
				? "Current Review"
				: null;

	return (
		<div
			className={[
				"ve-track-row__label",
				trackAttrs.trackRole === "incomingReview" ||
				trackAttrs.trackRole === "currentReview"
					? "ve-track-row__label--review"
					: null,
				isPreviewEnabled ? null : "ve-track-row__label--preview-disabled",
			]
				.filter(Boolean)
				.join(" ")}
			style={{
				opacity: isPreviewEnabled ? 1 : 0.72,
				borderLeft:
					trackAttrs.trackRole === "incomingReview" ||
					trackAttrs.trackRole === "currentReview"
						? "3px solid var(--ve-accent, #2563eb)"
						: undefined,
			}}
		>
			<div>
				<strong>{trackName}</strong>
				<small>
					{roleLabel ?? trackKind}
					{isPreviewEnabled ? null : " - Preview disabled"}
				</small>
			</div>
			<div className="ve-track-row__controls">
				<IconButton
					type="button"
					icon={Volume2}
					label={isMuted ? "Track muted" : "Track audible"}
					variant={isMuted ? "secondary" : "ghost"}
					disabled
				/>
				<IconButton
					type="button"
					icon={Lock}
					label={isLocked ? "Track locked" : "Track unlocked"}
					variant={isLocked ? "secondary" : "ghost"}
					disabled
				/>
				<IconButton
					type="button"
					icon={isPreviewEnabled ? Eye : EyeOff}
					label={
						isPreviewEnabled ? "Preview enabled" : "Preview disabled"
					}
					variant={isPreviewEnabled ? "ghost" : "secondary"}
					onClick={() =>
						dispatch("setTrackPreviewEnabled", {
							enabled: !isPreviewEnabled,
						})
					}
				/>
			</div>
		</div>
	);
};

export const TrackLane = ({
	timelineZoom,
	activeTool,
	selectedEntityId,
}: TrackRowProps) => {
	const clipScopes = useMany("clips");
	const trackAttrs = useAttrs([
		"enabled",
		"visibleInPreview",
		"trackRole",
	]) as TrackRenderAttrs;
	const trackWidth = Math.max(960, clipScopes.length * 180);
	const isReviewTrack =
		trackAttrs.trackRole === "incomingReview" ||
		trackAttrs.trackRole === "currentReview";
	const isPreviewEnabled =
		trackAttrs.enabled !== false && trackAttrs.visibleInPreview !== false;

	return (
		<div
			className={[
				"ve-track-row__rail",
				isReviewTrack ? "ve-track-row__rail--review" : null,
				isPreviewEnabled ? null : "ve-track-row__rail--preview-disabled",
			]
				.filter(Boolean)
				.join(" ")}
			style={{ opacity: isPreviewEnabled ? 1 : 0.72 }}
		>
			{clipScopes.length === 0 ? (
				<p className="ve-empty">Drop clips here.</p>
			) : (
				<div
					className="ve-track-row__timeline"
					style={{ width: `${trackWidth}px` }}
				>
					{clipScopes.map((clipScope) => (
						// readyAttr="start" belt-and-suspenders on top of ClipItem's own null check:
						// prevents the entire subtree from mounting during the skeleton window.
						<ScopeContext.Provider key={clipScope._nodeId} value={clipScope}>
							<ClipReadyGate
								timelineZoom={timelineZoom}
								activeTool={activeTool}
								selectedEntityId={selectedEntityId}
							/>
						</ScopeContext.Provider>
					))}
				</div>
			)}
		</div>
	);
};

/** Defers ClipItem until `start` attr has arrived from the worker. */
const ClipReadyGate = (props: TrackRowProps) => {
	const startAttr = useAttrs(["start"]);
	if (startAttr.start == null) {
		return null;
	}
	return <ClipItem {...props} />;
};
