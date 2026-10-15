import { For, onCleanup } from "solid-js";
import { useGpuixRequired } from "@gpuix/solid";
import { colors, metrics } from "../theme";
export type TabOption<Value extends string> = { value: Value; label: string };
export type TabsProps<Value extends string> = { options: readonly TabOption<Value>[]; value: Value; onChange: (value: Value) => void; label: string; disabled?: boolean; testId: string };
export const Tabs = <Value extends string,>(props: TabsProps<Value>) => {
 const renderer = useGpuixRequired();
 if (typeof renderer.focusElement !== "function") throw new Error("Tabs requires native focus");
 const focus = renderer.focusElement.bind(renderer);
 const refs = new Map<Value, { readonly id: number }>();
 onCleanup(() => refs.clear());
 const activate = (value: Value) => {
  if (props.disabled) return;
  const ref = refs.get(value); if (ref) focus(ref.id);
  if (value !== props.value) props.onChange(value);
 };
 return <div role="tablist" aria-label={props.label} testId={props.testId} style={{ display: "flex", gap: 4 }}>
  <For each={props.options}>{(option, index) => <div ref={(element) => { refs.set(option.value, element); }}
   role="tab" aria-label={option.label} aria-selected={props.value === option.value}
   tabIndex={!props.disabled && props.value === option.value ? 0 : -1} testId={props.testId + "-" + option.value}
   style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: metrics.radius, backgroundColor: props.value === option.value ? colors.accent : colors.control, color: colors.text, opacity: props.disabled ? 0.5 : 1 }}
   onClick={() => activate(option.value)} onKeyDown={(event) => {
    const n = props.options.length;
    switch (event.key) {
     case "enter": case "space": activate(option.value); break;
     case "left": activate(props.options[(index() + n - 1) % n].value); break;
     case "right": activate(props.options[(index() + 1) % n].value); break;
     case "home": activate(props.options[0].value); break;
     case "end": activate(props.options[n - 1].value); break;
    }
   }}><text>{option.label}</text></div>}</For>
 </div>;
};
