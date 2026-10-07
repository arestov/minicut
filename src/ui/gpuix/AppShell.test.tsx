import { afterEach, describe, expect, test } from "bun:test";
import { AppShell } from "./AppShell";
import { ClipInspector } from "./inspector/ClipInspector";
import { Sidebar } from "./panels/Sidebar";
import { renderWithScenario } from "./test/renderApp";
import { Timeline } from "./timeline/Timeline";

let view: Awaited<ReturnType<typeof renderWithScenario>> | null = null;

afterEach(() => {
	view?.destroy();
	view = null;
});

describe("AppShell", () => {
	test("shows the active project title and session state from DKT", async () => {
		view = await renderWithScenario("empty", () => <AppShell />);
		await view.untilAttr(view.rootScope, "timelineZoom", (v) => typeof v === "number");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		await view.untilAttr(project!, "title", (v) => typeof v === "string");
		view.settle();

		expect(view.texts()).toContain("Empty project");
		expect(view.texts()).toContain("00:00.00");
		expect(view.texts()).toContain("Paused");
		expect(view.renderer.findByTestId("app-shell")).toBeDefined();
		expect(view.renderer.findByTestId("preview-frame")).toBeDefined();
	});

	test("zoom buttons dispatch model actions and the toolbar follows the model", async () => {
		view = await renderWithScenario("empty", () => <AppShell />);
		const initial = (await view.untilAttr(
			view.rootScope,
			"timelineZoom",
			(v) => typeof v === "number",
		)) as number;
		view.settle();
		expect(view.texts()).toContain(`${initial} px/s`);

		view.click("zoom-in");
		const next = (await view.untilAttr(
			view.rootScope,
			"timelineZoom",
			(v) => typeof v === "number" && v > initial,
		)) as number;
		view.settle();

		expect(next).toBeGreaterThan(initial);
		expect(view.texts()).toContain(`${next} px/s`);
	});

	test("new project creates a second project through the model", async () => {
		view = await renderWithScenario("empty", () => <AppShell />);
		const first = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		await view.untilAttr(first!, "title", (v) => typeof v === "string");
		view.settle();
		expect(view.texts()).toContain("Empty project");

		view.click("new-project");
		const second = await view.untilOne(
			view.rootScope,
			"activeProject",
			(t) => t !== null && t._nodeId !== first?._nodeId,
		);
		await view.untilAttr(second!, "title", (v) => typeof v === "string");
		view.settle();

		expect(view.texts()).not.toContain("Empty project");
		expect(view.texts().some((text) => text.startsWith("Project "))).toBe(true);
	});
});

describe("AppShell with inspector, timeline and task progress", () => {
	test("selecting a clip fills the inspector and an export shows in the status bar", async () => {
		view = await renderWithScenario("timeline", () => (
			<AppShell
				sidebar={<Sidebar />}
				timeline={<Timeline viewportWidth={() => 600} />}
				inspector={<ClipInspector />}
			/>
		));
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const tracks = await view.untilMany(project!, "tracks", (n) => n >= 3);
		await view.untilAttr(tracks[0], "kind", (v) => typeof v === "string");
		const [clip] = await view.untilMany(tracks[0], "clips", (n) => n >= 1);
		for (const attr of ["name", "start", "duration"]) {
			await view.untilAttr(clip, attr, (v) => v !== undefined);
		}
		await view.untilAttr(view.rootScope, "timelineZoom", (v) => typeof v === "number");
		view.settle();
		expect(view.texts()).toContain("No clip selected");

		const target = view.centerOf("clip", 0);
		view.renderer.nativeSimulateMouseDown(target.x, target.y);
		view.renderer.nativeSimulateMouseUp(target.x, target.y);
		const selected = await view.untilOne(view.rootScope, "selectedClip", (t) => t !== null);
		await view.untilAttr(selected!, "name", (v) => typeof v === "string");
		view.settle();
		expect(view.texts()).not.toContain("No clip selected");
		expect(view.findAll("inspector-opacity-inc")).toHaveLength(1);

		await view.runtime.dispatchAndWait("requestProjectExport", {}, null);
		await view.untilAttr(
			view.rootScope,
			"exportProgress",
			(v) => (v as { stage?: string } | null)?.stage === "queued",
		);
		view.settle();
		expect(view.texts()).toContain("Export queued 0%");
		// The inspector is unaffected by the export.
		expect(view.findAll("inspector-opacity-inc")).toHaveLength(1);
	});
});

describe("AppShell preview", () => {
	test("the preview follows the model cursor and uploads a frame per cursor", async () => {
		view = await renderWithScenario("timeline", () => <AppShell />);
		await view.untilAttr(view.rootScope, "cursor", (v) => typeof v === "number");
		const uploads: number[] = [];
		const upload = view.renderer.setImagePixels.bind(view.renderer);
		view.renderer.setImagePixels = (...args: Parameters<typeof upload>) => {
			uploads.push(args[3].length);
			upload(...args);
		};

		await view.runtime.dispatchAndWait("commitSeek", { cursor: 2.5 }, null);
		await view.untilAttr(view.rootScope, "cursor", (v) => v === 2.5);
		view.settle();

		expect(view.texts()).toContain("00:02.50");
		// A 480x270 layout box at 2x: straight RGBA bytes.
		expect(uploads.at(-1)).toBe(960 * 540 * 4);
	});
});
