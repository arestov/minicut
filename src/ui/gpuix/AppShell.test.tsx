import { afterEach, describe, expect, test } from "bun:test";
import { AppShell } from "./AppShell";
import { HostServicesContext } from "./host/hostServices";
import { ClipInspector } from "./inspector/ClipInspector";
import { Sidebar } from "./panels/Sidebar";
import { renderWithScenario } from "./test/renderApp";
import { createSyntheticPreviewSource } from "./preview/syntheticFrameSource";
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

		await view.runtime.dispatchAndWait("requestProjectExport", { id: "export:test-1" }, null);
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

describe("AppShell host services", () => {
	test("the import control exists only when the host provides the dialog service", async () => {
		view = await renderWithScenario("empty", () => <AppShell />);
		view.settle();
		expect(view.findAll("import-media")).toHaveLength(0);
		view.destroy();

		let imports = 0;
		view = await renderWithScenario("empty", () => (
			<HostServicesContext.Provider
				value={{
					importFromDialog: async () => {
						imports += 1;
					},
					exportDirectory: "exports-dir", relinkFromDialog: async () => {},
				}}
			>
				<AppShell />
			</HostServicesContext.Provider>
		));
		view.settle();
		expect(view.findAll("import-media")).toHaveLength(1);

		view.click("import-media");
		expect(imports).toBe(1);
	});

	test("the export control requests an export with an id generated at the boundary", async () => {
		view = await renderWithScenario("timeline", () => (
			<HostServicesContext.Provider
				value={{ importFromDialog: async () => {}, exportDirectory: "exports-dir", relinkFromDialog: async () => {} }}
			>
				<AppShell />
			</HostServicesContext.Provider>
		));
		await view.untilAttr(view.rootScope, "exportProgress", () => true);
		view.settle();

		view.click("export-project");
		const queued = (await view.untilAttr(
			view.rootScope,
			"exportProgress",
			(v) => (v as { stage?: string } | null)?.stage === "queued",
		)) as { id: string };

		const request = (view.fakes.exportCalls[0] as { request: { id: string } }).request;
		expect(request.id).toBe(queued.id);
		expect(request.id).toMatch(/^export:[0-9a-f-]{36}$/);

		// Completion arrives as its own input step; the finished export shows where it went.
		await view.runtime.dispatchAndWait(
			"setExportProgress",
			{ id: queued.id, range: { type: "project" }, stage: "done", progress: 100, fileName: "out.webm", initiatedBy: null },
			null,
		);
		await view.untilAttr(
			view.rootScope,
			"exportProgress",
			(v) => (v as { stage?: string } | null)?.stage === "done",
		);
		view.settle();
		expect(view.texts()).toContain("exports-dir | out.webm");
	});

	test("a host preview service gets the model plan inputs and its notice is shown", async () => {
		const plans: Array<{ fps: number; clipSources: readonly unknown[] } | null> = [];
		const preview = {
			source: createSyntheticPreviewSource({ width: 480, height: 270 }),
			updatePlan: (input: { fps: number; clipSources: readonly unknown[] } | null) => {
				plans.push(input);
			},
			notice: () => "1 source file is missing",
		};
		view = await renderWithScenario("timeline", () => (
			<HostServicesContext.Provider
				value={{ importFromDialog: async () => {}, exportDirectory: "d", relinkFromDialog: async () => {}, preview }}
			>
				<AppShell />
			</HostServicesContext.Provider>
		));
		await view.untilAttr(view.rootScope, "previewStructure", (v) => ((v as { clipSources?: unknown[] } | null)?.clipSources?.length ?? 0) > 0);
		view.settle();

		const last = plans.filter(Boolean).at(-1);
		expect(last?.fps).toBe(30);
		expect(last?.clipSources.length).toBeGreaterThan(0);
		expect(view.texts()).toContain("1 source file is missing");
	});

	test("the play control starts and pauses a model playback run at the presented cursor", async () => {
		// A run the model started: pausing sets the model cursor to the presented position.
		const host = {
			importFromDialog: async () => {},
			exportDirectory: "d",
			relinkFromDialog: async () => {},
			playback: () => ({ runId: 1, presentationTime: 1.5, isPlaying: true, isScrubbing: false }),
		};
		view = await renderWithScenario("timeline", () => (
			<HostServicesContext.Provider value={host}>
				<AppShell />
			</HostServicesContext.Provider>
		));
		await view.untilAttr(view.rootScope, "playbackIntent", (v) => v === "paused");
		view.settle();
		expect(view.texts()).toContain("Play");

		view.click("play-toggle");
		await view.untilAttr(view.rootScope, "playbackIntent", (v) => v === "playing");
		view.settle();
		expect(view.texts()).toContain("Pause");
		// The model asked its playback executor to run.
		expect(view.fakes.playbackCalls.length).toBeGreaterThan(0);

		view.click("play-toggle");
		await view.untilAttr(view.rootScope, "playbackIntent", (v) => v === "paused");
		await view.untilAttr(view.rootScope, "cursor", (v) => v === 1.5);
	});
});
