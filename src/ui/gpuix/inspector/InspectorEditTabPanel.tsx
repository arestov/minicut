import { createEffect, createSignal, For, Show } from "solid-js";
import { Many, useActions, useAttrs, useScope } from "../../../dkt-solid-sync";
import type { TransformAttrs } from "../../../video-editor/models/Clip/types";
import { formatSeconds } from "../../../video-editor/components/format";
import { Button } from "../controls/Button";
import { Slider } from "../controls/Slider";
import { Stepper } from "../controls/Stepper";
import { InspectorTransformField } from "./InspectorTransformField";

import { formatInspectorTime } from "./format";

const transformFields = [
 { key: "x", label: "X", fallback: 0 },
 { key: "y", label: "Y", fallback: 0 },
 { key: "scale", label: "Scale", fallback: 1 },
 { key: "rotation", label: "Rotate", fallback: 0 },
] as const;

export const InspectorEditTabPanel = (props: { isCurrentOwner: () => boolean }) => {
 const clipId = useScope()()?._nodeId ?? "";
 const dispatch = useActions();
 const attrs = useAttrs(["opacity", "in", "fadeIn", "fadeOut", "duration", "start", "transform", "$meta$rels$effects$length", "$meta$rels$effects$exists"]);
 const current = () => !!clipId && props.isCurrentOwner();
 const opacity = () => Math.round(((attrs.opacity() as { value?: number } | null)?.value ?? 1) * 100);
 const timingReady = () => current() && [attrs.start(), attrs.in(), attrs.duration()].every(value => typeof value === "number" && Number.isFinite(value));
 const fade = (edge: "in" | "out") => Number((edge === "in" ? attrs.fadeIn() : attrs.fadeOut()) ?? 0);
 const changeFade = (edge: "in" | "out", delta: number) => {
  if (timingReady() && (delta > 0 || fade(edge) > 0)) dispatch("setFade", { edge, delta });
 };
 const trim = (edge: "start" | "end", delta: number) => {
  if (!timingReady() || (delta < 0 && (edge === "start" ? Number(attrs.start()) <= 0 : Number(attrs.duration()) <= 0.5))) return;
  dispatch("trim", { edge, delta });
 };
 const effectCount = () => Number(attrs["$meta$rels$effects$length"]() ?? 0);
 const [manage, setManage] = createSignal(false);
 createEffect(() => { if (effectCount() === 0) setManage(false); });
 const EffectRow = () => {
  const effectId = useScope()()?._nodeId;
  const effect = useAttrs(["name", "kind"]);
  return <div testId="inspector-effect-row" style={{ display: "flex", gap: 6 }}>
   <text>{String(effect.name() ?? "Effect")}</text><text>{String(effect.kind() ?? "")}</text>
   <Button testId={`inspector-effect-remove-${effectId ?? "missing"}`} aria-label={`Remove ${String(effect.name() ?? "effect")}`} disabled={!current() || !effectId} onClick={() => { if (current() && effectId) dispatch("removeEffect", { effectId }); }}><text>Remove</text></Button>
  </div>;
 };
 return <div testId="inspector-edit-controls" style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
  <Slider label="Opacity" testId="inspector-opacity" value={opacity()} valueText={`Opacity ${opacity()}%`} min={0} max={100} step={10} identityKey={clipId} disabled={!current()} onChange={opacityPercent => { if (current()) dispatch("updateOpacity", { opacityPercent }); }} />
  <For each={["in", "out"] as const}>{edge => <Stepper label={`Fade ${edge}`} testId={`inspector-fade-${edge}`} value={formatSeconds(fade(edge))} decrementDisabled={!timingReady() || fade(edge) <= 0} incrementDisabled={!timingReady()} onDecrement={() => changeFade(edge, -0.5)} onIncrement={() => changeFade(edge, 0.5)} />}</For>
  <text>{`In ${formatInspectorTime(attrs.in())}`}</text>
  <Stepper label="Start" testId="inspector-trim-start" value={formatInspectorTime(attrs.start())} decrementDisabled={!timingReady() || Number(attrs.start()) <= 0} incrementDisabled={!timingReady()} onDecrement={() => trim("start", -0.5)} onIncrement={() => trim("start", 0.5)} />
  <Stepper label="Duration" testId="inspector-trim-end" value={formatInspectorTime(attrs.duration())} decrementDisabled={!timingReady() || Number(attrs.duration()) <= 0.5} incrementDisabled={!timingReady()} onDecrement={() => trim("end", -0.5)} onIncrement={() => trim("end", 0.5)} />
  <text>Transform</text>
  <For each={transformFields}>{field => <InspectorTransformField label={field.label} testId={`inspector-transform-${field.key}`} value={(attrs.transform() as TransformAttrs | null)?.[field.key]?.value ?? field.fallback} ownerId={clipId} isCurrentOwner={current} disabled={!current()} onChange={value => { if (current()) dispatch("setTransform", { [field.key]: value }); }} />}</For>
  <text>Effects</text>
  <div style={{ display: "flex", gap: 6 }}><For each={["blur", "sharpen", "tint"] as const}>{kind => <Button testId={`inspector-effect-add-${kind}`} disabled={!current()} onClick={() => { if (current()) dispatch("addEffect", { kind }); }}><text>{kind[0].toUpperCase() + kind.slice(1)}</text></Button>}</For></div>
  <text testId="inspector-effects-count">{`${effectCount()} effects`}</text>
  <Show when={attrs["$meta$rels$effects$exists"]() === true}>
   <Button testId="inspector-effects-manage" disabled={!current()} active={manage()} onClick={() => { if (current()) setManage(value => !value); }}><text>Manage</text></Button>
  </Show>
  <Show when={manage()}><div testId="inspector-effects-menu" style={{ display: "flex", flexDirection: "column", gap: 6 }}><Many rel="effects" item={EffectRow} /></div></Show>
 </div>;
};
