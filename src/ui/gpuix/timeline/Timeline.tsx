import { createEffect, createMemo, createSignal, For } from "solid-js";
import { createWindowSize, useGpuixRequired } from "@gpuix/solid";
import { Many, One, useRootDispatch } from "../../../dkt-solid-sync";
import {
	TIMELINE_ZOOM_MAX,
	TIMELINE_ZOOM_MIN,
} from "../../../video-editor/models/sessionZoom";
import { Panel } from "../controls/Panel";
import { useRootAttrs } from "../hooks/useRootAttrs";
import { colors } from "../theme";
import { TrackRow } from "./TrackRow";
import {
	clamp,
	scrollAfterZoom,
	secondsAtWindowX,
	tickStep,
	visibleTickIndexes,
} from "./timelineGeometry";
import {
	HEADER_WIDTH,
	RULER_HEIGHT,
	TimelineViewContext,
	type TimelineView,
} from "./timelineView";

/** Empty time kept after the last clip so there is room to drop and extend. */
const TAIL_SECONDS = 10;
const FALLBACK_ZOOM = 56;

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

type ElementRef = { id: number };

/**
 * The timeline panel: ruler, track rows with clips, playhead.
 *
 * The horizontal scroll offset is view state owned here, in JS: the ruler,
 * the lanes and the playhead all translate from the same number so they move
 * together to the pixel. Vertical scroll of the rows is native. Zoom is the
 * model's session `timelineZoom`; the cursor is the session `cursor`.
 */
export const Timeline = (props: {
	/** Upper bound of the lane width for culling; defaults to the window width. */
	viewportWidth?: () => number;
}) => {
	const renderer = useGpuixRequired();
	const windowSize = createWindowSize();
	const dispatch = useRootDispatch();
	const session = useRootAttrs([
		"timelineZoom",
		"cursor",
		"selectedEntityId",
		"playbackBoundaryCursor",
	]);

	const [scrollX, setScrollX] = createSignal(0);
	const [scrubTime, setScrubTime] = createSignal<number | null>(null);
	let ruler: ElementRef | undefined;
	// Last zoom dispatched but possibly not yet echoed back by the model.
	let pendingZoom: number | null = null;

	const zoom = () => numberOr(session.timelineZoom(), FALLBACK_ZOOM);
	const duration = () => numberOr(session.playbackBoundaryCursor(), 0) + TAIL_SECONDS;
	createEffect(() => {
		// The model's value caught up: drop the prediction.
		if (zoom() === pendingZoom) pendingZoom = null;
	});
	const cursor = () => numberOr(session.cursor(), 0);
	const playhead = () => scrubTime() ?? cursor();
	const viewportWidth = () => props.viewportWidth?.() ?? windowSize().width;

	const view: TimelineView = {
		zoom,
		scrollX,
		viewportWidth,
		selectedEntityId: () => {
			const value = session.selectedEntityId();
			return typeof value === "string" ? value : null;
		},
	};

	const laneBounds = () => (ruler ? renderer.getElementBounds?.(ruler.id) : null);
	const maxScrollX = () => {
		const width = laneBounds()?.width ?? viewportWidth();
		return Math.max(0, duration() * zoom() - width);
	};

	const onScroll = (event: {
		deltaX?: number;
		deltaY?: number;
		x?: number;
		modifiers?: { cmd?: boolean; ctrl?: boolean; shift?: boolean };
	}) => {
		const deltaX = event.deltaX ?? 0;
		const deltaY = event.deltaY ?? 0;
		if (event.modifiers?.cmd || event.modifiers?.ctrl) {
			const bounds = laneBounds();
			// Start from the zoom last dispatched, not the model's possibly stale
			// attr, so rapid wheel events compound exactly like the model will.
			const from = pendingZoom ?? zoom();
			let to = clamp(
				Math.round(from * Math.exp(deltaY * 0.005)),
				TIMELINE_ZOOM_MIN,
				TIMELINE_ZOOM_MAX,
			);
			// Rounding must not swallow a small wheel step.
			if (to === from && deltaY !== 0) {
				to = clamp(from + (deltaY > 0 ? 1 : -1), TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX);
			}
			if (to === from) return;
			pendingZoom = to;
			const pointerOffsetX = (event.x ?? bounds?.x ?? 0) - (bounds?.x ?? 0);
			setScrollX(
				clamp(
					scrollAfterZoom({
						pointerOffsetX,
						scrollX: scrollX(),
						fromPxPerSecond: from,
						toPxPerSecond: to,
					}),
					0,
					Math.max(0, duration() * to - (bounds?.width ?? viewportWidth())),
				),
			);
			// The same value that the scroll was predicted with.
			dispatch("setTimelineZoom", to);
			return;
		}
		// Vertical wheel scrolls the rows natively; the timeline pans on X
		// (shift turns the vertical wheel into a horizontal pan).
		const panX = event.modifiers?.shift ? -deltaY : -deltaX;
		if (panX !== 0) {
			setScrollX(clamp(scrollX() + panX, 0, maxScrollX()));
		}
	};

	const timeAt = (x: number | undefined): number => {
		const bounds = laneBounds();
		return secondsAtWindowX({
			x: x ?? 0,
			laneLeft: bounds?.x ?? 0,
			scrollX: scrollX(),
			pxPerSecond: zoom(),
		});
	};

	let scrubbing = false;
	const ticks = createMemo(() => {
		const step = tickStep(zoom());
		return {
			step,
			indexes: visibleTickIndexes({
				scrollX: scrollX(),
				viewportWidth: viewportWidth(),
				pxPerSecond: zoom(),
				step,
			}),
		};
	});

	return (
		<TimelineViewContext.Provider value={view}>
			<Panel title="Timeline" testId="timeline" grow>
				<div
					testId="timeline-surface"
					style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, position: "relative" }}
					onScroll={onScroll}
				>
					<div style={{ display: "flex", flexDirection: "row", height: RULER_HEIGHT, flexShrink: 0 }}>
						<div
							style={{
								width: HEADER_WIDTH,
								flexShrink: 0,
								backgroundColor: colors.panelHeader,
								borderRightWidth: 1,
								borderBottomWidth: 1,
								borderColor: colors.border,
							}}
						/>
						<div
							testId="timeline-ruler"
							ref={(element: ElementRef) => {
								ruler = element;
							}}
							style={{
								position: "relative",
								flexGrow: 1,
								minWidth: 0,
								overflow: "hidden",
								backgroundColor: colors.panelHeader,
								borderBottomWidth: 1,
								borderColor: colors.border,
								cursor: "col-resize",
							}}
							onMouseDown={(event) => {
								if (event.button !== undefined && event.button !== 0) return;
								scrubbing = true;
								setScrubTime(timeAt(event.x));
							}}
							onMouseMove={(event) => {
								if (scrubbing && event.pressedButton === 0) {
									setScrubTime(timeAt(event.x));
								}
							}}
							onMouseUp={(event) => {
								if (!scrubbing) return;
								scrubbing = false;
								const time = timeAt(event.x);
								setScrubTime(null);
								dispatch("commitSeek", { cursor: time });
							}}
						>
							<div
								style={{
									position: "absolute",
									left: -scrollX(),
									top: 0,
									bottom: 0,
									width: 1,
									pointerEvents: "none",
								}}
							>
								<For each={ticks().indexes}>
									{(index) => (
										<div
											style={{
												position: "absolute",
												left: index * ticks().step * zoom(),
												top: 0,
												width: 1,
												height: RULER_HEIGHT,
												backgroundColor: colors.border,
											}}
										>
											<text style={{ position: "absolute", left: 4, top: 7, color: colors.textMuted, fontSize: 10, whiteSpace: "nowrap" }}>
												{`${Math.round(index * ticks().step * 100) / 100}s`}
											</text>
										</div>
									)}
								</For>
							</div>
						</div>
					</div>
					<div
						testId="timeline-rows"
						style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll" }}
					>
						<One rel="activeProject">
							<Many rel="tracks" item={TrackRow} readyAttr="kind" />
						</One>
					</div>
					<div
						testId="timeline-playhead-layer"
						style={{
							position: "absolute",
							left: HEADER_WIDTH,
							right: 0,
							top: 0,
							bottom: 0,
							overflow: "hidden",
							pointerEvents: "none",
						}}
					>
						<div
							testId="timeline-playhead"
							style={{
								position: "absolute",
								left: playhead() * zoom() - scrollX(),
								top: 0,
								bottom: 0,
								width: 2,
								backgroundColor: colors.accent,
								pointerEvents: "none",
							}}
						/>
					</div>
				</div>
			</Panel>
		</TimelineViewContext.Provider>
	);
};
