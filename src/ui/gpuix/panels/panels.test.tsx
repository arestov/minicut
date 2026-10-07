import { afterEach, describe, expect, test } from "bun:test";
import { AppShell } from "../AppShell";
import { HostServicesContext } from "../host/hostServices";
import { renderWithScenario } from "../test/renderApp";
import { describeResourceNote } from "./resourceLabels";
import { Sidebar } from "./Sidebar";

let view: Awaited<ReturnType<typeof renderWithScenario>> | null = null;

afterEach(() => {
	view?.destroy();
	view = null;
});

const renderShell = (scenario: Parameters<typeof renderWithScenario>[0]) =>
	renderWithScenario(scenario, () => <AppShell sidebar={<Sidebar />} />);

describe("describeResourceNote", () => {
	test("maps one attr value to one label", () => {
		expect(describeResourceNote({ originalAccessStatus: "missing" })?.label).toBe(
			"File missing",
		);
		expect(describeResourceNote({ originalAccessStatus: "denied" })?.label).toBe(
			"Access denied",
		);
		expect(describeResourceNote({ status: "needs-permission" })?.label).toBe(
			"Needs permission",
		);
		expect(
			describeResourceNote({ localMediaAvailability: "ready-project-copy" })?.label,
		).toBe("Using project copy");
		expect(
			describeResourceNote({ status: "ready", originalAccessStatus: "unknown" }),
		).toBeNull();
	});
});

describe("project and resource panels", () => {
	test("list the project and its resources from the timeline scenario", async () => {
		view = await renderShell("timeline");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const resources = await view.untilMany(project!, "resources", (n) => n >= 2);
		for (const resource of resources) {
			await view.untilAttr(resource, "name", (v) => typeof v === "string");
			await view.untilAttr(resource, "duration", (v) => typeof v === "number");
			await view.untilAttr(resource, "size", (v) => typeof v === "number");
		}
		await view.untilAttr(project!, "title", (v) => typeof v === "string");
		view.settle();

		expect(view.texts()).toContain("Timeline project");
		expect(view.texts()).toContain("Interview.mp4");
		expect(view.texts()).toContain("Music.wav");
		expect(view.texts()).toContain("video | 42.0s | 4.6 MB");
		expect(view.renderer.findByTestId("resource-note")).toBeUndefined();
	});

	test("show a note for a resource whose file is unavailable", async () => {
		view = await renderShell("unavailable-resource");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const [resource] = await view.untilMany(project!, "resources", (n) => n >= 1);
		await view.untilAttr(resource, "originalAccessStatus", (v) => v === "missing");
		view.settle();

		expect(view.texts()).toContain("Lost footage.mov");
		expect(view.texts()).toContain("File missing");
	});

	test("clicking a project row switches the active project and its resources", async () => {
		view = await renderShell("timeline");
		const first = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		await view.untilAttr(first!, "title", (v) => typeof v === "string");
		view.settle();
		expect(view.texts()).toContain("Interview.mp4");

		view.click("new-project");
		const second = await view.untilOne(
			view.rootScope,
			"activeProject",
			(t) => t !== null && t._nodeId !== first!._nodeId,
		);
		await view.untilAttr(second!, "title", (v) => typeof v === "string");
		view.settle();
		expect(view.texts()).not.toContain("Interview.mp4");
		expect(view.texts()).toContain("No resources");

		// Rows: the boot project, the scenario project, the new project.
		view.click("project-row", 1);
		const back = await view.untilOne(
			view.rootScope,
			"activeProject",
			(t) => t?._nodeId === first!._nodeId,
		);
		const resources = await view.untilMany(back!, "resources", (n) => n >= 2);
		for (const resource of resources) {
			await view.untilAttr(resource, "name", (v) => typeof v === "string");
		}
		view.settle();
		expect(view.texts()).toContain("Interview.mp4");
		expect(view.texts()).toContain("Music.wav");
	});

	test("the add button puts the resource on the timeline through a model action", async () => {
		view = await renderShell("unavailable-resource");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const [resource] = await view.untilMany(project!, "resources", (n) => n >= 1);
		await view.untilAttr(resource, "name", (v) => typeof v === "string");
		view.settle();

		const verifier = view.verifier();
		const tracks = await verifier.waitMany(project!, "tracks", 2);
		expect(view.runtime.readMany(tracks[0], "clips")).toHaveLength(1);

		view.click("resource-add");
		await verifier.waitMany(tracks[0], "clips", 2);

		expect(view.runtime.readMany(tracks[0], "clips")).toHaveLength(2);
	});

	test("a missing file offers locate and replace only when the host has a dialog service", async () => {
		view = await renderShell("unavailable-resource");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const [resource] = await view.untilMany(project!, "resources", (n) => n >= 1);
		await view.untilAttr(resource, "originalAccessStatus", (v) => v === "missing");
		view.settle();
		expect(view.findAll("resource-locate")).toHaveLength(0);
		view.destroy();

		const calls: Array<[string, string]> = [];
		view = await renderWithScenario("unavailable-resource", () => (
			<HostServicesContext.Provider
				value={{
					importFromDialog: async () => {},
					exportDirectory: "d",
					relinkFromDialog: async (id, intent) => {
						calls.push([id, intent]);
					},
				}}
			>
				<AppShell sidebar={<Sidebar />} />
			</HostServicesContext.Provider>
		));
		const project2 = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const [resource2] = await view.untilMany(project2!, "resources", (n) => n >= 1);
		await view.untilAttr(resource2, "originalAccessStatus", (v) => v === "missing");
		view.settle();

		view.click("resource-locate");
		view.click("resource-replace");

		expect(calls).toEqual([
			[resource2._nodeId, "locate-original"],
			[resource2._nodeId, "replace-source"],
		]);
	});
});
