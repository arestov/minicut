import { createEffect, createSignal, For } from "solid-js";
import { colors, metrics } from "../theme";
export type ColorFieldProps = {
	value: string;
	identityKey: string;
	onChange: (color: string) => void;
	label: string;
	disabled?: boolean;
	testId: string;
};
const SWATCHES = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#7c3aed", "#0891b2"] as const;
const normalizeHex = (text: string) => /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : null;
export const ColorField = (props: ColorFieldProps) => {
	const [draft, setDraft] = createSignal(props.value);
	const [invalid, setInvalid] = createSignal(false);
	let draftOwner = props.identityKey;
	const reset = () => { draftOwner = props.identityKey; setDraft(props.value); setInvalid(false); };
	createEffect(() => { props.value; props.identityKey; props.disabled; reset(); });
	const choose = (color: string) => {
		if (props.disabled)
			return;
		reset();
		if (color !== normalizeHex(props.value))
			props.onChange(color);
	};
	return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
  <text>{props.label}</text>
  <div style={{ display: "flex", gap: 6 }}>
   <div testId={props.testId + "-preview"} style={{ width: 24, height: 28, backgroundColor: normalizeHex(props.value) ?? colors.control, borderRadius: metrics.radius }}/>
   <input testId={props.testId} aria-label={props.label} value={draft()} readOnly={!!props.disabled} tabIndex={props.disabled ? -1 : 0} style={{ flexGrow: 1, minWidth: 0, height: 28, color: colors.text, backgroundColor: colors.control, opacity: props.disabled ? 0.5 : 1 }} onChange={(event) => {
			if (props.disabled)
				return;
			if (draftOwner !== props.identityKey) {
				reset();
				return;
			}
			const text = event.value ?? "";
			setDraft(text);
			const color = normalizeHex(text);
			setInvalid(color === null);
			if (color !== null && color !== normalizeHex(props.value))
				props.onChange(color);
		}} onSubmit={reset} onBlur={reset} onKeyDown={(event) => { if (event.key === "escape")
		reset(); }}/>
  </div>
  <text testId={props.testId + "-helper"}>{invalid() || normalizeHex(props.value) === null ? "Enter # and six hexadecimal digits" : "HEX color, for example #2563eb"}</text>
  <div style={{ display: "flex", gap: 6 }}>
   <For each={SWATCHES}>{(hex) => <div testId={props.testId + "-" + hex.slice(1)} role="button" aria-label={"Set color " + hex} aria-selected={normalizeHex(props.value) === hex} tabIndex={props.disabled ? -1 : 0} style={{ width: 24, height: 24, backgroundColor: hex, borderRadius: metrics.radius, borderWidth: normalizeHex(props.value) === hex ? 2 : 0, borderColor: colors.text, opacity: props.disabled ? 0.5 : 1 }} onClick={() => choose(hex)} onKeyDown={(event) => { if (event.key === "enter" || event.key === "space")
			choose(hex); }}/>}</For>
  </div>
 </div>;
};
