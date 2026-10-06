import { afterEach, describe, expect, test } from "bun:test";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { renderWithScenario } from "../test/renderApp";
import { Timeline } from "./Timeline";
import {
	isSpanVisible,
	scrollAfterZoom,
	secondsAtWindowX,
	tickStep,
	visibleTickIndexes,
} from "./timelineGeometry";

type View = Awaited<ReturnType<typeof renderWithScenario>>;

let view: View | null = null;

afterEach(() => {
	view?.destroy();
	view = null;
});

const VIEWPORT = 300;

const renderTimeline = (
	scenario: Parameters<typeof renderWithScenario>[0],
	options: Parameters<typeof renderWithScenario>[2] = {},
) =>
	renderWithScenario(
		scenario,
		() => (
			<div style={{ display: "flex", flexDirection: "column", width: 1000, height: 320 }}>
				<Timeline viewportWidth={() => VIEWPORT} />
			</div>
		),
		options,
	);


/** Waits until the rows exist and every clip attr the view reads has arrived. */
const loaded = async (current: View) => {
	const project = await current.untilOne(current.rootScope, "activeProject", (t) => t !== null);
	const tracks = await current.untilMany(project!, "tracks", (n) => n >= 3);
	for (const track of tracks) {
		await current.untilAttr(track, "kind", (v) => typeof v === "string");
	}
	for (const track of tracks) {
		await current.untilMany(track, "clips", () => true);
		for (const clip of current.runtime.readMany(track, "clips")) {
			await current.untilAttr(clip, "duration", (v) => typeof v === "number");
			await current.untilAttr(clip, "start", (v) => typeof v === "number");
			await current.untilAttr(clip, "name", (v) => typeof v === "string");
		}
	}
	await current.untilAttr(current.rootScope, "timelineZoom", (v) => typeof v === "number");
	current.settle();
	return { project: project!, tracks };
};

const renderedClips = (current: View) => current.findAll("clip").length;

describe("timeline geometry", () => {
	test("tick step keeps ticks at least the minimum gap apart", () => {
		expect(tickStep(56) * 56).toBeGreaterThanOrEqual(64);
		expect(tickStep(8)).toBeGreaterThan(tickStep(96));
	});

	test("visible ticks cover the viewport and start at zero", () => {
		const indexes = visibleTickIndexes({
			scrollX: 0,
			viewportWidth: 300,
			pxPerSecond: 50,
			step: 2,
			margin: 0,
		});
		expect(indexes[0]).toBe(0);
		expect(indexes[indexes.length - 1]).toBe(3);
	});

	test("span culling keeps spans that touch the viewport margin", () => {
		const base = { pxPerSecond: 10, scrollX: 1000, viewportWidth: 200, margin: 0 };
		expect(isSpanVisible({ ...base, start: 0, duration: 50 })).toBe(false);
		expect(isSpanVisible({ ...base, start: 0, duration: 100 })).toBe(true);
		expect(isSpanVisible({ ...base, start: 119, duration: 5 })).toBe(true);
		expect(isSpanVisible({ ...base, start: 130, duration: 5 })).toBe(false);
	});

	test("pointer to time and zoom anchoring agree", () => {
		expect(
			secondsAtWindowX({ x: 340, laneLeft: 140, scrollX: 100, pxPerSecond: 50 }),
		).toBe(6);
		const scrollX = scrollAfterZoom({
			pointerOffsetX: 200,
			scrollX: 100,
			fromPxPerSecond: 50,
			toPxPerSecond: 100,
		});
		expect(secondsAtWindowX({ x: 340, laneLeft: 140, scrollX, pxPerSecond: 100 })).toBe(6);
	});
});

describe("Timeline", () => {
	test("renders the model's tracks and clips", async () => {
		view = await renderTimeline("timeline");
		await loaded(view);

		const names = view.texts();
		expect(names).toContain("V1");
		expect(names).toContain("A1");
		expect(names).toContain("V2");
		expect(names).toContain("Intro");
		expect(names).toContain("Interview A");
		expect(names).toContain("Music bed");
		expect(view.findAll("track-row")).toHaveLength(3);
	});

	test("clip width follows the model zoom", async () => {
		view = await renderTimeline("timeline");
		await loaded(view);
		const intro = view.centerOf("clip", 0).bounds;
		// Intro lasts 4 s; the border takes 2 px of the reported width.
		expect(Math.abs(intro.width - 4 * 56)).toBeLessThanOrEqual(2);

		view.runtime.dispatchAction("setTimelineZoom", 80, view.rootScope);
		await view.untilAttr(view.rootScope, "timelineZoom", (v) => v === 80);
		view.settle();

		expect(Math.abs(view.centerOf("clip", 0).bounds.width - 4 * 80)).toBeLessThanOrEqual(2);
	});

	test("culls clips outside the viewport and follows a pan", async () => {
		view = await renderTimeline("large", { clipCount: 45 });
		await loaded(view);

		const initiallyRendered = renderedClips(view);
		expect(initiallyRendered).toBeGreaterThan(0);
		expect(initiallyRendered).toBeLessThan(45);
		expect(view.texts()).toContain("Clip 1");
		expect(view.texts()).not.toContain("Clip 40");

		const surface = view.centerOf("timeline-surface");
		// A wheel delta of -1400 pans the lanes 1400 px to the right in time.
		view.renderer.nativeSimulateScrollWheel(surface.x, surface.y, -1400, 0);
		view.settle();

		expect(view.texts()).not.toContain("Clip 1");
		expect(view.texts()).toContain("Clip 40");
		expect(renderedClips(view)).toBeLessThan(45);
	});

	test("pressing a clip selects it through the model", async () => {
		view = await renderTimeline("timeline");
		const { tracks } = await loaded(view);
		const clips = view.runtime.readMany(tracks[0], "clips");

		const target = view.centerOf("clip", 1);
		view.renderer.nativeSimulateMouseDown(target.x, target.y);
		view.renderer.nativeSimulateMouseUp(target.x, target.y);
		const selected = await view.untilAttr(
			view.rootScope,
			"selectedEntityId",
			(v) => typeof v === "string",
		);

		expect(clips.map((clip) => clip._nodeId)).toContain(selected as string);
	});

	test("dragging a clip dispatches moveBy with the dragged seconds", async () => {
		view = await renderTimeline("timeline");
		const { tracks } = await loaded(view);
		const clip = view.runtime.readMany(tracks[0], "clips")[0];
		const before = view.runtime.readAttrs(clip, ["start"]).start as number;

		const target = view.centerOf("clip", 0);
		view.renderer.nativeSimulateMouseDown(target.x, target.y);
		// One second at 56 px/s, in two moves.
		view.renderer.nativeSimulateMouseMove(target.x + 28, target.y, 0);
		view.renderer.nativeSimulateMouseMove(target.x + 56, target.y, 0);
		view.renderer.nativeSimulateMouseUp(target.x + 56, target.y);
		const after = (await view.untilAttr(
			clip,
			"start",
			(v) => typeof v === "number" && v > before,
		)) as number;

		expect(after).toBeCloseTo(before + 1, 1);
	});

	test("rapid ctrl+wheel zoom compounds from the dispatched value", async () => {
		view = await renderTimeline("timeline");
		await loaded(view);
		const surface = view.centerOf("timeline-surface");

		// 56 -> round(56*e^-0.5) = 34 -> round(34*e^-0.5) = 21, without waiting
		// for the model to echo the first step.
		view.renderer.nativeSimulateScrollWheel(surface.x, surface.y, 0, -100, "ctrl");
		view.renderer.nativeSimulateScrollWheel(surface.x, surface.y, 0, -100, "ctrl");

		expect(await view.untilAttr(view.rootScope, "timelineZoom", (v) => v === 21)).toBe(21);
	});

	test("a drag released outside the clip still commits", async () => {
		view = await renderTimeline("timeline");
		const { tracks } = await loaded(view);
		const clip = view.runtime.readMany(tracks[0], "clips")[0];
		const before = view.runtime.readAttrs(clip, ["start"]).start as number;

		const target = view.centerOf("clip", 0);
		view.renderer.nativeSimulateMouseDown(target.x, target.y);
		view.renderer.nativeSimulateMouseMove(target.x + 56, target.y, 0);
		// Release far away from the clip, in the empty area below the rows.
		view.renderer.nativeSimulateMouseUp(target.x + 600, target.y + 400);
		const after = (await view.untilAttr(
			clip,
			"start",
			(v) => typeof v === "number" && v > before,
		)) as number;

		expect(after).toBeCloseTo(before + 1, 1);
	});

	test("dragging a trim handle changes the duration", async () => {
		view = await renderTimeline("timeline");
		const { tracks } = await loaded(view);
		const clip = view.runtime.readMany(tracks[0], "clips")[0];
		const before = view.runtime.readAttrs(clip, ["duration"]).duration as number;

		const handle = view.centerOf("clip-trim-end", 0);
		view.renderer.nativeSimulateMouseDown(handle.x, handle.y);
		view.renderer.nativeSimulateMouseMove(handle.x + 56, handle.y, 0);
		view.renderer.nativeSimulateMouseUp(handle.x + 56, handle.y);
		const after = (await view.untilAttr(
			clip,
			"duration",
			(v) => typeof v === "number" && v > before,
		)) as number;

		expect(after).toBeCloseTo(before + 1, 1);
	});

	test("scrubbing the ruler commits the cursor", async () => {
		view = await renderTimeline("timeline");
		await loaded(view);
		const ruler = view.centerOf("timeline-ruler").bounds;

		// 5 seconds at 56 px/s from the lane's left edge.
		const x = ruler.x + 5 * 56;
		const y = ruler.y + ruler.height / 2;
		view.renderer.nativeSimulateMouseDown(x, y);
		view.renderer.nativeSimulateMouseUp(x, y);
		const cursor = (await view.untilAttr(
			view.rootScope,
			"cursor",
			(v) => typeof v === "number" && v > 0,
		)) as number;

		expect(cursor).toBeCloseTo(5, 0);
	});
});
