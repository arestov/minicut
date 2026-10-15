import { createEffect, createMemo, onCleanup } from "solid-js";
import { useGpuixRequired } from "@gpuix/solid";
import { colors } from "../theme";
export type SliderProps = {
	value: number;
	min: number;
	max: number;
	step: number;
	label: string;
	valueText: string;
	onChange: (value: number) => void;
	identityKey: string;
	disabled?: boolean;
	testId: string;
};
export const Slider = (props: SliderProps) => {
	const renderer = useGpuixRequired();
	if (typeof renderer.getElementBounds !== "function" || typeof renderer.focusElement !== "function")
		throw new Error("Slider requires native bounds and focus methods");
	const boundsFor = renderer.getElementBounds.bind(renderer);
	const focus = renderer.focusElement.bind(renderer);
	let rail: {
		readonly id: number;
	} | undefined;
	let dragOwner: string | null = null;
	const ready = createMemo(() => !props.disabled && Number.isFinite(props.value));
	createEffect(() => {
		const steps = (props.max - props.min) / props.step;
		if (![props.min, props.max, props.step].every(Number.isFinite) || props.max <= props.min ||
			props.step <= 0 || Math.abs(steps - Math.round(steps)) > 1e-8)
			throw new Error("Slider requires a finite ordered range with an integral number of positive steps");
		props.identityKey;
		ready();
		dragOwner = null;
	});
	onCleanup(() => { dragOwner = null; });
	const clamp = (n: number) => Math.min(props.max, Math.max(props.min, n));
	const quantize = (n: number) => clamp(Number((props.min + Math.round((n - props.min) / props.step) * props.step).toFixed(12)));
	const emit = (n: number) => { if (ready() && n !== props.value)
		props.onChange(n); };
	const sample = (event: {
		x?: number;
		y?: number;
	}) => {
		if (!rail || !Number.isFinite(event.x) || !Number.isFinite(event.y))
			return null;
		const b = boundsFor(rail.id);
		if (!b || b.width <= 10 || b.height <= 0 || event.x! < b.x || event.x! > b.x + b.width ||
			event.y! < b.y || event.y! > b.y + b.height)
			return null;
		const t = Math.max(0, Math.min(1, (event.x! - b.x - 5) / (b.width - 10)));
		return quantize(props.min + t * (props.max - props.min));
	};
	const fraction = () => Number.isFinite(props.value) ? Math.max(0, Math.min(1, (props.value - props.min) / (props.max - props.min))) : 0;
	return <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
  <div style={{ display: "flex", justifyContent: "space-between" }}><text>{props.label}</text><text>{props.valueText}</text></div>
  <div ref={(element) => { rail = element; }} testId={props.testId} role="slider" aria-label={props.label} aria-valuetext={props.valueText} tabIndex={ready() ? 0 : -1} style={{ display: "flex", alignItems: "center", height: 28, flexGrow: 1, minWidth: 0, opacity: ready() ? 1 : 0.5, userSelect: "none" }} onMouseDown={(event) => {
			if (!ready() || (event.button !== undefined && event.button !== 0))
				return;
			const next = sample(event);
			if (next === null || !rail)
				return;
			dragOwner = props.identityKey;
			focus(rail.id);
			emit(next);
		}} onMouseMove={(event) => {
			if (dragOwner === null)
				return;
			if (!ready() || dragOwner !== props.identityKey || event.pressedButton !== 0) {
				dragOwner = null;
				return;
			}
			const next = sample(event);
			if (next === null) {
				dragOwner = null;
				return;
			}
			emit(next);
		}} onMouseUp={() => { dragOwner = null; }} onMouseLeave={() => { dragOwner = null; }} onBlur={() => { dragOwner = null; }} onKeyDown={(event) => {
			if (!ready())
				return;
			let next: number;
			switch (event.key) {
				case "left":
				case "down":
					next = quantize(props.value - props.step);
					break;
				case "right":
				case "up":
					next = quantize(props.value + props.step);
					break;
				case "home":
					next = props.min;
					break;
				case "end":
					next = props.max;
					break;
				default: return;
			}
			dragOwner = null;
			emit(next);
		}}>
   <div style={{ pointerEvents: "none", height: 4, flexBasis: 0, minWidth: 0, flexGrow: fraction(), backgroundColor: colors.accent }}/>
   <div style={{ pointerEvents: "none", width: 10, height: 10, flexShrink: 0, borderRadius: 5, backgroundColor: colors.text }}/>
   <div style={{ pointerEvents: "none", height: 4, flexBasis: 0, minWidth: 0, flexGrow: 1 - fraction(), backgroundColor: colors.control }}/>
  </div>
 </div>;
};
