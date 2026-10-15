import { createEffect, createSignal } from "solid-js";
import { colors } from "../theme";

export type InspectorTransformFieldProps = {
 value: number; ownerId: string; isCurrentOwner: () => boolean; label: string; testId: string;
 onChange: (value: number) => void; disabled?: boolean;
};
/** Immediate finite numeric edits; incomplete text belongs only to this input. */
export const InspectorTransformField = (props: InspectorTransformFieldProps) => {
 const [text, setText] = createSignal(String(props.value));
 const [invalid, setInvalid] = createSignal(false);
 let draftOwner = props.ownerId;
 const reset = () => { draftOwner = props.ownerId; setText(String(props.value)); setInvalid(false); };
 createEffect(() => { props.value; props.ownerId; props.disabled; props.isCurrentOwner(); reset(); });
 return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
  <text>{props.label}</text>
  <input testId={props.testId} aria-label={props.label} value={text()} readOnly={props.disabled || !props.isCurrentOwner()} tabIndex={props.disabled || !props.isCurrentOwner() ? -1 : 0} style={{ height: 28, color: colors.text, backgroundColor: colors.control }} onChange={event => {
   if (props.disabled || !props.isCurrentOwner() || draftOwner !== props.ownerId) { reset(); return; }
   const next = event.value ?? "";
   setText(next);
   const number = next.trim() === "" ? NaN : Number(next);
   const finite = Number.isFinite(number);
   setInvalid(!finite);
   if (finite && number !== props.value) props.onChange(number);
  }} onSubmit={reset} onBlur={reset} onKeyDown={event => { if (event.key === "escape") reset(); }} />
  <ShowHelper invalid={invalid()} scale={props.label === "Scale"} />
 </div>;
};
const ShowHelper = (props: { invalid: boolean; scale: boolean }) => <text style={{ color: colors.textMuted, fontSize: 10 }}>{props.invalid ? "Enter a finite number" : props.scale ? "Increment 0.1" : ""}</text>;
