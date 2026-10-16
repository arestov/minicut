import { createAttrsFor, useActions, useAttrs, useOne, useScope, useScopeRuntime } from "../../../dkt-solid-sync";
import { Slider } from "../controls/Slider";

export const InspectorAudioTabPanel = (props: { isCurrentOwner: () => boolean }) => {
 const clipId = useScope()()?._nodeId ?? "";
 const dispatch = useActions();
 const attrs = useAttrs(["audio", "mediaKind"]);
 const resource = useOne("resource");
 const resourceAttrs = createAttrsFor(useScopeRuntime(), resource, ["kind"]);
 const audioEligible = () => !!clipId && props.isCurrentOwner() && (attrs.mediaKind() ?? resourceAttrs.kind()) === "audio";
 const gain = () => Math.round(((attrs.audio() as { gain?: number } | null)?.gain ?? 1) * 100);
 return <div testId="inspector-audio-controls" style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
  <text>Clip audio</text>
  <Slider label="Gain" testId="inspector-audio-gain" value={gain()} valueText={`${gain()}%`} min={0} max={150} step={1} identityKey={clipId} disabled={!audioEligible()} onChange={value => { if (audioEligible()) dispatch("setAudio", { gain: value / 100 }); }} />
  <text>{(attrs.mediaKind() ?? resourceAttrs.kind()) === "audio" ? `Gain ${gain()}%` : "Select an audio clip to edit playback settings."}</text>
 </div>;
};
