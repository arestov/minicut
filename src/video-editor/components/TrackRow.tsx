import { Eye, Lock, Volume2 } from "lucide-react";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
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
}

export const TrackLabel = () => {
	const trackAttrs = useAttrs([
		"name",
		"kind",
		"muted",
		"locked",
	]) as TrackRenderAttrs;
	const trackName = String(trackAttrs.name);
	const trackKind = String(trackAttrs.kind);
	const isMuted = Boolean(trackAttrs.muted);
	const isLocked = Boolean(trackAttrs.locked);

	return (
		<div className="ve-track-row__label">
			<div>
				<strong>{trackName}</strong>
				<small>{trackKind}</small>
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
					icon={Eye}
					label="Track visible"
					variant="ghost"
					disabled
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
	const trackWidth = Math.max(960, clipScopes.length * 180);

	return (
		<div className="ve-track-row__rail">
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
