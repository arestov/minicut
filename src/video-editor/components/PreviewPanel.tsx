import { Gauge, Pause, Play, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRootAttrs } from "../../dkt-react-sync/hooks/useRootAttrs";
import { useRootDispatch } from "../../dkt-react-sync/hooks/useRootDispatch";
import { useVideoEditor } from "../app/VideoEditorContext";
import type {
	PreviewFrame,
	PreviewStructure,
	RenderedClip,
} from "../read-model/previewReadModel";
import { ColorScopesPanel, type ScopeMode } from "./ColorScopesPanel";
import { Button, IconButton } from "./ControlPrimitives";
import { formatSeconds } from "./format";
import type { PreviewMediaElementRegistry } from "./mediaElementRegistry";
import { RendererStage } from "./RendererStage";

const previewWindowRequestIntervalMs = 200;
const emptyPreviewStructure: PreviewStructure = { clipSources: [] };
const emptyPreviewFrame: PreviewFrame = {
	cursor: 0,
	renderedClips: [],
	visualRenderedClips: [],
	audioRenderedClips: [],
	activeClipNames: [],
};

const PreviewStage = ({
	frame,
	structure,
	isPlaying,
	resolveResourceUrl,
	requestResourcePlayheadWindow,
	noteResourcePreviewError,
	compareMode,
	mediaElementRegistry,
}: {
	frame: PreviewFrame;
	structure: PreviewStructure;
	isPlaying: boolean;
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string;
	requestResourcePlayheadWindow: (resourceId: string, time: number) => void;
	noteResourcePreviewError: (resourceId: string) => void;
	compareMode: "off" | "split";
	mediaElementRegistry: PreviewMediaElementRegistry;
}) => {
	const lastWindowRequestAtRef = useRef(new Map<string, number>());
	const resolvedClip = (clip: RenderedClip): RenderedClip => ({
		...clip,
		resourceUrl: clip.resourceId
			? resolveResourceUrl(clip.resourceId, clip.resourceUrl)
			: clip.resourceUrl,
	});
	const resolvedFrame: PreviewFrame = {
		...frame,
		renderedClips: frame.renderedClips.map(resolvedClip),
		visualRenderedClips: frame.visualRenderedClips.map(resolvedClip),
		audioRenderedClips: frame.audioRenderedClips.map(resolvedClip),
	};

	useEffect(() => {
		const now = performance.now();
		for (const clip of frame.renderedClips) {
			if (
				!clip.resourceId ||
				(clip.resourceKind !== "video" && clip.resourceKind !== "audio")
			) {
				continue;
			}

			const lastRequestedAt =
				lastWindowRequestAtRef.current.get(clip.resourceId) ?? 0;
			if (isPlaying && now - lastRequestedAt < previewWindowRequestIntervalMs) {
				continue;
			}

			lastWindowRequestAtRef.current.set(clip.resourceId, now);
			requestResourcePlayheadWindow(
				clip.resourceId,
				Math.max(0, frame.cursor - clip.start + clip.inPoint),
			);
		}
	}, [frame, isPlaying, requestResourcePlayheadWindow]);

	return (
		<RendererStage
			structure={structure}
			frame={resolvedFrame}
			isPlaying={isPlaying}
			mediaElementRegistry={mediaElementRegistry}
			compareMode={compareMode}
			onClipMediaError={(resourceId) => noteResourcePreviewError(resourceId)}
		/>
	);
};

const PreviewPlaybackButton = ({
	isPlaying,
	onTogglePlayback,
}: {
	isPlaying: boolean;
	onTogglePlayback: () => void;
}) => (
	<IconButton
		type="button"
		icon={isPlaying ? Pause : Play}
		label={isPlaying ? "Pause" : "Play"}
		variant="default"
		onClick={onTogglePlayback}
	>
		{isPlaying ? "Pause" : "Play"}
	</IconButton>
);

const PreviewCursorReadout = ({ frame }: { frame: PreviewFrame }) => (
	<>
		<span className="ve-sr-only">Cursor at {formatSeconds(frame.cursor)}</span>
		<span>{formatSeconds(frame.cursor)}</span>
	</>
);

const PreviewActiveClipsReadout = ({ frame }: { frame: PreviewFrame }) => (
	<span>
		{frame.activeClipNames.length > 0
			? frame.activeClipNames.join(", ")
			: "No active clips"}
	</span>
);

const PreviewTransport = ({
	frame,
	isPlaying,
	onTogglePlayback,
}: {
	frame: PreviewFrame;
	isPlaying: boolean;
	onTogglePlayback: () => void;
}) => (
	<div className="ve-preview-transport" aria-label="Preview transport status">
		<div>
			<Timer size={15} aria-hidden="true" />
			<PreviewCursorReadout frame={frame} />
		</div>
		<div>
			<Gauge size={15} aria-hidden="true" />
			<span>Draft preview</span>
		</div>
		<div className="ve-preview-transport__active">
			<PreviewActiveClipsReadout frame={frame} />
		</div>
		<div className="ve-preview-transport__playback">
			<PreviewPlaybackButton
				isPlaying={isPlaying}
				onTogglePlayback={onTogglePlayback}
			/>
		</div>
	</div>
);

export const PreviewPanel = ({
	mediaElementRegistry,
}: {
	mediaElementRegistry: PreviewMediaElementRegistry;
}) => {
	const {
		resolveResourceUrl,
		requestResourcePlayheadWindow,
		noteResourcePreviewError,
	} = useVideoEditor();
	const sessionDispatch = useRootDispatch();
	const attrs = useRootAttrs([
		"activeInspectorTab",
		"isPlaying",
		"previewFrame",
		"previewStructure",
	]) as {
		activeInspectorTab?: unknown;
		isPlaying?: unknown;
		previewFrame?: PreviewFrame;
		previewStructure?: PreviewStructure;
	};
	const frame = attrs.previewFrame ?? emptyPreviewFrame;
	const structure = attrs.previewStructure ?? emptyPreviewStructure;
	const [compareMode, setCompareMode] = useState<"off" | "split">("off");
	const [scopeMode, setScopeMode] = useState<ScopeMode>("waveform");
	const showColorScopes = attrs.activeInspectorTab === "color";

	return (
		<section className="ve-panel ve-preview-panel" aria-label="Preview panel">
			<div className="ve-panel__header">
				<h2>Preview</h2>
				<div className="ve-preview-tools" aria-label="Preview color tools">
					<Button
						type="button"
						variant={compareMode === "split" ? "default" : "secondary"}
						onClick={() =>
							setCompareMode((value) => (value === "split" ? "off" : "split"))
						}
					>
						Split compare
					</Button>
				</div>
			</div>
			<PreviewStage
				frame={frame}
				structure={structure}
				isPlaying={attrs.isPlaying === true}
				resolveResourceUrl={resolveResourceUrl}
				requestResourcePlayheadWindow={requestResourcePlayheadWindow}
				noteResourcePreviewError={noteResourcePreviewError}
				compareMode={compareMode}
				mediaElementRegistry={mediaElementRegistry}
			/>
			{showColorScopes ? (
				<ColorScopesPanel
					frame={frame}
					mode={scopeMode}
					onModeChange={setScopeMode}
					resolveResourceUrl={resolveResourceUrl}
					mediaElementRegistry={mediaElementRegistry}
				/>
			) : null}
			<PreviewTransport
				frame={frame}
				isPlaying={attrs.isPlaying === true}
				onTogglePlayback={() => sessionDispatch("togglePlayback")}
			/>
		</section>
	);
};
