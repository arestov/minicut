import { createEffect, createSignal, Show } from "solid-js";
import { ScopeContext, useActions, useAttrs, useOne } from "../../../dkt-solid-sync";
import { formatSeconds } from "../../../video-editor/components/format";
import { colors, metrics } from "../theme";

export type InspectorTrackPosition = { trackName: string; ordinal: number };
type PreviewProps = { name: string; color: string; mediaKind: unknown };
const Preview = (props: PreviewProps & { resourceKind?: unknown }) => <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
 <div testId="inspector-thumbnail" role="img" aria-label={`${props.name} clip preview unavailable`} style={{ width: 56, height: 40, borderWidth: 1, borderColor: props.color, alignItems: "center", justifyContent: "center", display: "flex" }}><text>{(props.mediaKind ?? props.resourceKind) === "audio" ? "AUD" : "CLIP"}</text></div>
 <text style={{ color: colors.textMuted, fontSize: 10 }}>Thumbnail unavailable</text>
</div>;
const ResourcePreview = (props: PreviewProps) => {
 const attrs = useAttrs(["kind"]);
 return <Preview name={props.name} color={props.color} mediaKind={props.mediaKind} resourceKind={attrs.kind()} />;
};
export const InspectorClipHeader = (props: { trackPosition: InspectorTrackPosition | null; isCurrentOwner: () => boolean }) => {
 const attrs = useAttrs(["name", "color", "start", "duration", "mediaKind"]);
 const resource = useOne("resource");
 const dispatch = useActions();
 const name = () => String(attrs.name() ?? "");
 const color = () => String(attrs.color() ?? "#2563eb");
 let draft: string | null = null;
 const [shown, setShown] = createSignal(name());
 const reset = () => { draft = null; setShown(name()); };
 createEffect(() => { const canonical = name(); draft = null; setShown(canonical); });
 const commit = () => {
  const next = draft;
  draft = null;
  if (!props.isCurrentOwner() || next === null || next.trim() === "" || next === name()) { setShown(name()); return; }
  dispatch("rename", { name: next });
 };
 return <div testId="inspector-header" style={{ display: "flex", flexDirection: "column", padding: 10, gap: 6 }}>
  <Show when={resource()} keyed fallback={<Preview name={name()} color={color()} mediaKind={attrs.mediaKind()} />}>{scope => <ScopeContext.Provider value={() => scope}><ResourcePreview name={name()} color={color()} mediaKind={attrs.mediaKind()} /></ScopeContext.Provider>}</Show>
  <input testId="inspector-name" aria-label="Clip name" value={shown()} style={{ height: 28, color: colors.text, backgroundColor: colors.control, borderRadius: metrics.radius, paddingLeft: 8, fontSize: 12 }} onChange={event => { if (!props.isCurrentOwner()) { reset(); return; } draft = event.value ?? ""; setShown(draft); }} onSubmit={commit} onBlur={commit} onKeyDown={event => { if (event.key === "escape") reset(); }} />
  <text style={{ color: colors.textMuted, fontSize: 11 }}>{`Clip ${props.trackPosition?.ordinal ?? 1} - ${props.trackPosition?.trackName ?? "Track"} - ${formatSeconds(Number(attrs.start()))} - Duration ${formatSeconds(Number(attrs.duration()))}`}</text>
 </div>;
};
