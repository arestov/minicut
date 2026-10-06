import { afterEach, describe, expect, test } from "bun:test";
import { AppShell } from "./AppShell";
import { renderWithScenario } from "./test/renderApp";

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
