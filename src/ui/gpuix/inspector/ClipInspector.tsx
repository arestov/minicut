import { createEffect, createSignal } from "solid-js";
import { One, useActions, useAttrs } from "../../../dkt-solid-sync";
import { Panel } from "../controls/Panel";
import { Stepper } from "../controls/Stepper";
import { colors, metrics } from "../theme";

const OPACITY_STEP_PERCENT = 10;
const SCALE_STEP = 0.1;
const MIN_SCALE = 0.1;
const MOVE_STEP_SECONDS = 0.5;
const RESIZE_STEP_SECONDS = 0.5;

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const scalarValue = (value: unknown, fallback: number): number =>
	numberOr((value as { value?: unknown } | null)?.value, fallback);

const roundTo = (value: number, digits: number): number => {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
};

const InspectorBody = () => {
	const attrs = useAttrs(["name", "start", "duration", "opacity", "transform"]);
	const dispatch = useActions();
	let draft: string | null = null;
	// What the input shows: the model name, or the draft while typing.
	const [shown, setShown] = createSignal(String(attrs.name()));
	createEffect(() => setShown(String(attrs.name())));

	const opacityPercent = () => Math.round(scalarValue(attrs.opacity(), 1) * 100);
	const scale = () =>
		scalarValue((attrs.transform() as { scale?: unknown } | null)?.scale, 1);

	const commitName = () => {
		const next = draft;
		draft = null;
		if (next === null || next === attrs.name()) return;
		if (next.trim() === "") {
			// An empty name is not sent: show the model value again.
			setShown(String(attrs.name()));
			return;
		}
		dispatch("rename", { name: next });
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 6,
				padding: 10,
				overflowY: "scroll",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
				<text style={{ color: colors.textMuted, fontSize: 12, width: 64 }}>Name</text>
				<input
					testId="inspector-name"
					value={shown()}
					style={{
						flexGrow: 1,
						minWidth: 0,
						height: 28,
						fontSize: 12,
						color: colors.text,
						backgroundColor: colors.control,
						borderRadius: metrics.radius,
						paddingLeft: 8,
						paddingRight: 8,
					}}
					onChange={(event) => {
						draft = event.value ?? "";
						setShown(draft);
					}}
					onSubmit={commitName}
					onBlur={commitName}
				/>
			</div>
			<Stepper
				label="Start"
				testId="inspector-start"
				value={`${roundTo(numberOr(attrs.start(), 0), 2)}s`}
				onDecrement={() => dispatch("moveBy", { delta: -MOVE_STEP_SECONDS })}
				onIncrement={() => dispatch("moveBy", { delta: MOVE_STEP_SECONDS })}
			/>
			<Stepper
				label="Duration"
				testId="inspector-duration"
				value={`${roundTo(numberOr(attrs.duration(), 0), 2)}s`}
				onDecrement={() =>
					dispatch("resize", { edge: "end", delta: -RESIZE_STEP_SECONDS })
				}
				onIncrement={() =>
					dispatch("resize", { edge: "end", delta: RESIZE_STEP_SECONDS })
				}
			/>
			<Stepper
				label="Opacity"
				testId="inspector-opacity"
				value={`${opacityPercent()}%`}
				decrementDisabled={opacityPercent() <= 0}
				incrementDisabled={opacityPercent() >= 100}
				onDecrement={() =>
					dispatch("updateOpacity", {
						opacityPercent: Math.max(0, opacityPercent() - OPACITY_STEP_PERCENT),
					})
				}
				onIncrement={() =>
					dispatch("updateOpacity", {
						opacityPercent: Math.min(100, opacityPercent() + OPACITY_STEP_PERCENT),
					})
				}
			/>
			<Stepper
				label="Scale"
				testId="inspector-scale"
				value={`${roundTo(scale(), 2)}x`}
				decrementDisabled={scale() <= MIN_SCALE}
				onDecrement={() =>
					dispatch("setTransform", {
						scale: Math.max(MIN_SCALE, roundTo(scale() - SCALE_STEP, 2)),
					})
				}
				onIncrement={() =>
					dispatch("setTransform", { scale: roundTo(scale() + SCALE_STEP, 2) })
				}
			/>
		</div>
	);
};

/**
 * Attributes of the clip the model reports as selected (the session
 * `selectedClip` rel). Every edit is an existing clip action on that clip's
 * scope; the displayed values come back through the model.
 */
export const ClipInspector = () => (
	<Panel title="Inspector" testId="inspector" width={metrics.inspectorWidth}>
		<One
			rel="selectedClip"
			readyAttr="name"
			fallback={
				<div style={{ padding: 12 }}>
					<text testId="inspector-empty" style={{ color: colors.textMuted, fontSize: 12 }}>
						No clip selected
					</text>
				</div>
			}
		>
			<InspectorBody />
		</One>
	</Panel>
);
