import { Volume2 } from "lucide-react";
import { ScopeContext } from "../../../dkt-react-sync/context/ScopeContext";
import { useActions } from "../../../dkt-react-sync/hooks/useActions";
import { useAttrs } from "../../../dkt-react-sync/hooks/useAttrs";
import { useOne } from "../../../dkt-react-sync/hooks/useOne";
import { InspectorSection } from "./InspectorSection";
import type { ClipRenderAttrs, ResourceRenderAttrs } from "./types";

type ClipDispatch = ReturnType<typeof useActions>;

const InspectorAudioControls = ({
	attrs,
	dispatch,
	resourceKind,
}: {
	attrs: ClipRenderAttrs;
	dispatch: ClipDispatch;
	resourceKind: unknown;
}) => {
	const selectedMediaKind = attrs.mediaKind ?? resourceKind;
	const isAudioClip = selectedMediaKind === "audio";
	const audio = attrs.audio;

	return (
		<div
			className="ve-inspector-tab-panel"
			role="tabpanel"
			aria-label="Audio inspector"
		>
			<InspectorSection title="Clip audio" icon={Volume2}>
				<label className="ve-slider-field">
					<span>Gain</span>
					<input
						type="range"
						aria-label="Gain"
						min="0"
						max="150"
						value={Math.round((audio?.gain ?? 1) * 100)}
						disabled={!isAudioClip}
						onChange={(event) =>
							dispatch("setAudio", {
								gain: Number(event.currentTarget.value) / 100,
							})
						}
					/>
				</label>
				<p className="ve-preview__summary">
					{isAudioClip
						? `Gain ${Math.round((audio?.gain ?? 1) * 100)}%`
						: "Select an audio clip to edit playback settings."}
				</p>
			</InspectorSection>
		</div>
	);
};

const InspectorAudioControlsWithResource = ({
	attrs,
	dispatch,
}: {
	attrs: ClipRenderAttrs;
	dispatch: ClipDispatch;
}) => {
	const resourceAttrs = useAttrs(["kind"]) as ResourceRenderAttrs;

	return (
		<InspectorAudioControls
			attrs={attrs}
			dispatch={dispatch}
			resourceKind={resourceAttrs.kind ?? "image"}
		/>
	);
};

export const InspectorAudioTabPanel = () => {
	const clipDispatch = useActions();
	const attrs = useAttrs(["audio", "mediaKind"]) as ClipRenderAttrs;
	const resourceScope = useOne("resource");

	if (!resourceScope) {
		return (
			<InspectorAudioControls
				attrs={attrs}
				dispatch={clipDispatch}
				resourceKind="image"
			/>
		);
	}

	return (
		<ScopeContext.Provider value={resourceScope}>
			<InspectorAudioControlsWithResource
				attrs={attrs}
				dispatch={clipDispatch}
			/>
		</ScopeContext.Provider>
	);
};
