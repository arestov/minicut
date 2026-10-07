import { afterEach, describe, expect, test } from "bun:test";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { renderWithScenario } from "../test/renderApp";
import { Timeline } from "../timeline/Timeline";
import { ClipInspector } from "./ClipInspector";

type View = Awaited<ReturnType<typeof renderWithScenario>>;

let view: View | null = null;

afterEach(() => {
	view?.destroy();
	view = null;
});

const renderInspector = () =>
	renderWithScenario("timeline", () => (
		<div style={{ display: "flex", flexDirection: "column", width: 1000, height: 600 }}>
			<div style={{ display: "flex", height: 300 }}>
				<ClipInspector />
			</div>
			<div style={{ display: "flex", flexDirection: "column", height: 300 }}>
				<Timeline viewportWidth={() => 600} />
			</div>
		</div>
	));

/** Waits for the first track's clips and the attrs the timeline reads. */
const firstClip = async (current: View): Promise<ReactSyncScopeHandle> => {
	const project = await current.untilOne(current.rootScope, "activeProject", (t) => t !== null);
	const tracks = await current.untilMany(project!, "tracks", (n) => n >= 3);
	await current.untilAttr(tracks[0], "kind", (v) => typeof v === "string");
	const [clip] = await current.untilMany(tracks[0], "clips", (n) => n >= 1);
	for (const attr of ["name", "start", "duration"]) {
		await current.untilAttr(clip, attr, (v) => v !== undefined);
	}
	await current.untilAttr(current.rootScope, "timelineZoom", (v) => typeof v === "number");
	current.settle();
	return clip;
};

const selectFirstClip = async (current: View): Promise<ReactSyncScopeHandle> => {
	const clip = await firstClip(current);
	const target = current.centerOf("clip", 0);
	current.renderer.nativeSimulateMouseDown(target.x, target.y);
	current.renderer.nativeSimulateMouseUp(target.x, target.y);
	const selected = await current.untilOne(
		current.rootScope,
		"selectedClip",
		(t) => t !== null,
	);
	expect(selected?._nodeId).toBe(clip._nodeId);
	await current.untilAttr(selected!, "name", (v) => typeof v === "string");
	await current.untilAttr(selected!, "opacity", (v) => v !== undefined);
	await current.untilAttr(selected!, "transform", (v) => v !== undefined);
	current.settle();
	return selected!;
};

describe("clip inspector", () => {
	test("shows a placeholder while nothing is selected", async () => {
		view = await renderInspector();
		await firstClip(view);

		expect(view.texts()).toContain("No clip selected");
		expect(view.findAll("inspector-opacity-inc")).toHaveLength(0);
	});

	test("shows the attrs of the clip the model reports as selected", async () => {
		view = await renderInspector();
		await selectFirstClip(view);

		expect(view.texts()).not.toContain("No clip selected");
		expect(view.texts()).toContain("0s");
		expect(view.texts()).toContain("4s");
		expect(view.texts()).toContain("100%");
		expect(view.texts()).toContain("1x");
	});

	test("the opacity stepper edits through updateOpacity and reads back", async () => {
		view = await renderInspector();
		const clip = await selectFirstClip(view);

		view.click("inspector-opacity-dec");
		await view.untilAttr(
			clip,
			"opacity",
			(v) => (v as { value?: number } | null)?.value === 0.9,
		);
		view.settle();

		expect(view.texts()).toContain("90%");
	});

	test("timing and scale steppers dispatch the clip actions", async () => {
		view = await renderInspector();
		const clip = await selectFirstClip(view);

		view.click("inspector-start-inc");
		await view.untilAttr(clip, "start", (v) => v === 0.5);
		view.click("inspector-duration-inc");
		await view.untilAttr(clip, "duration", (v) => v === 4.5);
		view.click("inspector-scale-inc");
		await view.untilAttr(
			clip,
			"transform",
			(v) => (v as { scale?: { value?: number } } | null)?.scale?.value === 1.1,
		);
		view.settle();

		expect(view.texts()).toContain("0.5s");
		expect(view.texts()).toContain("4.5s");
		expect(view.texts()).toContain("1.1x");
	});

	test("typing a name and pressing enter dispatches one rename and the model echoes it", async () => {
		view = await renderInspector();
		const clip = await selectFirstClip(view);
		const renames: unknown[] = [];
		const getDispatch = view.runtime.getDispatch.bind(view.runtime);
		view.runtime.getDispatch = (scope) => {
			const dispatch = getDispatch(scope);
			return (name, payload, meta) => {
				if (name === "rename") renames.push(payload);
				return dispatch(name, payload, meta);
			};
		};
		const input = view.renderer.findByTestId("inspector-name");
		expect(input).toBeDefined();

		view.renderer.nativeSimulateKeystrokes(input!.id, "x enter");
		// A second submit with nothing typed must not send another rename.
		view.renderer.nativeSimulateKeystrokes(input!.id, "enter");
		await view.untilAttr(clip, "name", (v) => typeof v === "string" && v.endsWith("x"));
		view.settle();

		expect(renames).toHaveLength(1);
		expect(renames[0]).toEqual({ name: "Introx" });
	});

	test("an empty name is not sent and the input shows the model value again", async () => {
		view = await renderInspector();
		const clip = await selectFirstClip(view);
		const renames: unknown[] = [];
		const getDispatch = view.runtime.getDispatch.bind(view.runtime);
		view.runtime.getDispatch = (scope) => {
			const dispatch = getDispatch(scope);
			return (name, payload, meta) => {
				if (name === "rename") renames.push(payload);
				return dispatch(name, payload, meta);
			};
		};
		const input = view.renderer.findByTestId("inspector-name");

		view.renderer.nativeSimulateKeystrokes(
			input!.id,
			`${"backspace ".repeat(5)}enter`,
		);
		view.settle();

		expect(renames).toHaveLength(0);
		expect(view.runtime.readAttrs(clip, ["name"]).name).toBe("Intro");
	});
});
