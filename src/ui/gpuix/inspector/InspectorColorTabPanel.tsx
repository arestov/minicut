import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useGpuixRequired } from "@gpuix/solid";
import { createDispatchFor, Many, useActions, useAttrs, useScope, useScopeRuntime } from "../../../dkt-solid-sync";

import { ColorField } from "../controls/ColorField";
import { Slider } from "../controls/Slider";
import { Button } from "../controls/Button";
import { colorGradePresets } from "../../../video-editor/components/inspector/types";

const fields = [
 { key: "exposure", label: "Exposure", min: -100, max: 100, fallback: 0 },
 { key: "contrast", label: "Contrast", min: 0, max: 200, fallback: 1 },
 { key: "saturation", label: "Saturation", min: 0, max: 250, fallback: 1 },
 { key: "temperature", label: "Temperature", min: -100, max: 100, fallback: 0 },
] as const;
const CorrectionControls = (props: { isCurrentOwner: () => boolean }) => {
 const scope = useScope();
 const capturedScope = scope();
 const effectId = capturedScope?._nodeId ?? "";
 const runtime = useScopeRuntime();
 const attrs = useAttrs(["enabled", "params"]);
 const dispatch = useActions();
 const params = () => (attrs.params() ?? {}) as Record<string, unknown>;
 const param = (key: string, fallback: number) => Number((params()[key] as { value?: unknown } | null)?.value ?? fallback);
 const renderer = useGpuixRequired();
 if (typeof renderer.focusElement !== "function") throw new Error("Before requires native focus");
 const focus = renderer.focusElement.bind(renderer);
 let element: { readonly id: number } | undefined;
 let held: { restore: () => void } | null = null;
 const [pressed, setPressed] = createSignal(false);
 const ready = () => !!effectId && props.isCurrentOwner() && attrs.enabled() != null;
 const finish = () => { const previous = held; held = null; setPressed(false); previous?.restore(); };
 const begin = () => {
  if (held || !ready() || attrs.enabled() !== true || !capturedScope) return;
  const capturedDispatch = createDispatchFor(runtime, () => capturedScope);
  held = { restore: () => capturedDispatch("setEffectEnabled", { enabled: true }) };
  setPressed(true);
  if (element) focus(element.id);
  capturedDispatch("setEffectEnabled", { enabled: false });
 };
 createEffect(() => { const available = ready(); if (held && !available) finish(); });
 onCleanup(finish);
 return <div testId={`inspector-correction-${effectId}`} style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
  <text>Color correction</text>
  <text testId={`inspector-grade-status-${effectId}`}>{attrs.enabled() === false ? "Bypassed" : "Enabled"}</text>
  <For each={fields}>{field => <Slider label={field.label} testId={`inspector-grade-${field.key}-${effectId}`} value={Math.round(param(field.key, field.fallback) * 100)} valueText={`${field.label} ${Math.round(param(field.key, field.fallback) * 100)}%`} min={field.min} max={field.max} step={1} identityKey={effectId} disabled={!ready()} onChange={value => { if (ready()) dispatch("patchEffectParams", { params: { [field.key]: { value: value / 100 }, lookId: "custom" } }); }} />}</For>
  <div style={{ display: "flex", gap: 6 }}>
   <Button testId={`inspector-grade-bypass-${effectId}`} disabled={!ready()} onClick={() => { if (ready()) dispatch("setEffectEnabled", { enabled: !attrs.enabled() }); }}><text>{attrs.enabled() === false ? "Enable" : "Bypass"}</text></Button>
   <Button testId={`inspector-grade-reset-${effectId}`} disabled={!ready()} onClick={() => { if (ready()) dispatch("patchEffectParams", { params: { lookId: "clean", lookIntensity: { value: 1 }, exposure: { value: 0 }, contrast: { value: 1 }, saturation: { value: 1 }, gamma: { value: 1 }, temperature: { value: 0 }, hue: { value: 0 } } }); }}><text>Reset</text></Button>
  </div>
  <div style={{ display: "flex", gap: 6 }}><For each={colorGradePresets}>{preset => <Button testId={`inspector-grade-preset-${preset.id}-${effectId}`} disabled={!ready()} onClick={() => {
   if (!ready()) return;
   const patch: Record<string, unknown> = { lookId: "custom", lookIntensity: { value: 1 } };
   for (const [key, value] of Object.entries(preset.params)) if (typeof value === "number") patch[key] = { value };
   dispatch("patchEffectParams", { params: patch });
  }}><text>{preset.label}</text></Button>}</For></div>
  <div ref={ref => { element = ref; }} role="button" aria-label="Before" aria-selected={pressed()} tabIndex={ready() ? 0 : -1} testId={`inspector-before-${effectId}`} style={{ height: 28, display: "flex", alignItems: "center" }} onMouseDown={event => { if (event.button == null || event.button === 0) begin(); }} onMouseUp={finish} onMouseLeave={finish} onBlur={finish} onKeyDown={event => { if (event.key === "enter" || event.key === "space") begin(); }} onKeyUp={event => { if (event.key === "enter" || event.key === "space") finish(); }}><text>{pressed() ? "Before held" : "Press and hold: Before"}</text></div>
 </div>;
};
export const InspectorColorTabPanel = (props: { isCurrentOwner: () => boolean }) => {
 const clipId = useScope()()?._nodeId ?? "";
 const attrs = useAttrs(["color", "$meta$rels$colorCorrectionEffects$exists"]);
 const dispatch = useActions();
 const current = () => !!clipId && props.isCurrentOwner();
 const Row = () => <CorrectionControls isCurrentOwner={props.isCurrentOwner} />;
 return <div testId="inspector-color-controls" style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
  <ColorField label="Clip label" testId="inspector-label-color" identityKey={clipId} value={String(attrs.color() ?? "#2563eb")} disabled={!current()} onChange={color => { if (current()) dispatch("color", { color }); }} />
  <Show when={attrs["$meta$rels$colorCorrectionEffects$exists"]() === false}><Button testId="inspector-correction-add" disabled={!current()} onClick={() => { if (current() && attrs["$meta$rels$colorCorrectionEffects$exists"]() === false) dispatch("addEffect", { kind: "color-correction", name: "Color correction" }); }}><text>Add color correction</text></Button></Show>
  <Many rel="colorCorrectionEffects" readyAttr="enabled" item={Row} />
 </div>;
};
