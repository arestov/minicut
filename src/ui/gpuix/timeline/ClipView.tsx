import { createSignal, Show } from "solid-js";
import {
	useActions,
	useAttrs,
	useRootDispatch,
	useScope,
} from "../../../dkt-solid-sync";
import { colors } from "../theme";
import { isSpanVisible } from "./timelineGeometry";
import { useTimelineView } from "./timelineView";

const TRIM_HANDLE_WIDTH = 7;
const CLIP_INSET = 3;
const MIN_PREVIEW_DURATION = 0.5;
const FALLBACK_CLIP_COLOR = "#2563eb";

type DragKind = "move" | "trim-start" | "trim-end";
type Drag = { kind: DragKind; originX: number; deltaPx: number };

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100;

/**
 * One clip. Position and size come from the clip's own attrs (start, duration)
 * and the session zoom. The native element only exists while the clip
 * intersects the viewport (culling), so a pannable surface with hundreds of
 * clips keeps a small native tree.
 *
 * A drag only moves a local preview (a pixel offset). On release the gesture
 * becomes one model action on the clip scope (`moveBy` / `resize` with a
 * delta in seconds); the model owns clamping, rounding and the new timing.
 */
export const ClipView = () => {
	const view = useTimelineView();
	const scope = useScope();
	const dispatch = useActions();
	const rootDispatch = useRootDispatch();
	const attrs = useAttrs(["name", "color", "start", "duration"]);
	const [drag, setDrag] = createSignal<Drag | null>(null);

	const clipId = () => scope()?._nodeId ?? null;
	// A clip is placed only once both timing attrs have arrived: until then
	// its rel exists but its attrs do not (skeleton race).
	const arrived = () => attrs.start() != null && attrs.duration() != null;
	const previewSeconds = () => {
		const current = drag();
		return current ? current.deltaPx / view.zoom() : 0;
	};
	const start = () => {
		const base = numberOr(attrs.start(), 0);
		const kind = drag()?.kind;
		if (kind === "move" || kind === "trim-start") {
			return Math.max(0, base + previewSeconds());
		}
		return base;
	};
	const duration = () => {
		const base = numberOr(attrs.duration(), 0);
		const kind = drag()?.kind;
		if (kind === "trim-start") {
			return Math.max(MIN_PREVIEW_DURATION, base - previewSeconds());
		}
		if (kind === "trim-end") {
			return Math.max(MIN_PREVIEW_DURATION, base + previewSeconds());
		}
		return base;
	};
	const width = () => Math.max(2, duration() * view.zoom());
	const selected = () => clipId() !== null && view.selectedEntityId() === clipId();
	const visible = () =>
		arrived() &&
		isSpanVisible({
			start: start(),
			duration: duration(),
			pxPerSecond: view.zoom(),
			scrollX: view.scrollX(),
			viewportWidth: view.viewportWidth(),
		});

	const begin = (kind: DragKind, event: { x?: number; button?: number }) => {
		if (event.button !== undefined && event.button !== 0) return;
		const id = clipId();
		if (id) rootDispatch("selectEntity", id);
		setDrag({ kind, originX: event.x ?? 0, deltaPx: 0 });
	};

	const move = (event: { x?: number; pressedButton?: number }) => {
		const current = drag();
		if (!current || event.pressedButton !== 0) return;
		setDrag({ ...current, deltaPx: (event.x ?? current.originX) - current.originX });
	};

	const end = () => {
		const current = drag();
		setDrag(null);
		if (!current) return;
		const delta = roundToHundredths(current.deltaPx / view.zoom());
		if (delta === 0) return;
		if (current.kind === "move") {
			dispatch("moveBy", { delta });
		} else {
			dispatch("resize", {
				edge: current.kind === "trim-start" ? "start" : "end",
				delta,
			});
		}
	};

	const color = () =>
		typeof attrs.color() === "string" ? (attrs.color() as string) : FALLBACK_CLIP_COLOR;

	return (
		<Show when={visible()}>
			<div
				testId="clip"
				aria-label={String(attrs.name())}
				aria-selected={selected()}
				style={{
					position: "absolute",
					left: start() * view.zoom(),
					top: CLIP_INSET,
					bottom: CLIP_INSET,
					width: width(),
					borderRadius: 4,
					backgroundColor: color(),
					borderWidth: selected() ? 2 : 1,
					borderColor: selected() ? "#ffffff" : "#00000066",
					overflow: "hidden",
					cursor: "grab",
					userSelect: "none",
				}}
				onMouseDown={(event) => begin("move", event)}
				onMouseMove={move}
				onMouseUp={end}
			>
				<Show when={width() > 22}>
					<div style={{ paddingLeft: 6, paddingTop: 3, paddingRight: 4 }}>
						<text
							style={{
								color: colors.text,
								fontSize: 11,
								whiteSpace: "nowrap",
								textOverflow: "ellipsis",
							}}
						>
							{String(attrs.name())}
						</text>
					</div>
				</Show>
				<Show when={width() > TRIM_HANDLE_WIDTH * 3}>
					<div
						testId="clip-trim-start"
						style={{
							position: "absolute",
							top: 0,
							bottom: 0,
							left: 0,
							width: TRIM_HANDLE_WIDTH,
							cursor: "col-resize",
							backgroundColor: "#ffffff14",
							hover: { backgroundColor: "#ffffff3d" },
						}}
						onMouseDown={(event) => begin("trim-start", event)}
						onMouseMove={move}
						onMouseUp={end}
					/>
					<div
						testId="clip-trim-end"
						style={{
							position: "absolute",
							top: 0,
							bottom: 0,
							right: 0,
							width: TRIM_HANDLE_WIDTH,
							cursor: "col-resize",
							backgroundColor: "#ffffff14",
							hover: { backgroundColor: "#ffffff3d" },
						}}
						onMouseDown={(event) => begin("trim-end", event)}
						onMouseMove={move}
						onMouseUp={end}
					/>
				</Show>
			</div>
		</Show>
	);
};
