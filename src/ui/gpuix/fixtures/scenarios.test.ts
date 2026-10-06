import { afterEach, describe, expect, test } from "bun:test";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { createInProcessDkt, type InProcessDkt } from "../host/createInProcessDkt";
import { createScenarioDriver, type ScenarioDriver } from "./scenarioDriver";
import {
	resolveScenarioSelection,
	SCENARIO_NAMES,
	seedScenario,
	type ScenarioName,
	type ScenarioOptions,
} from "./scenarios";

let dkt: InProcessDkt | null = null;
let driver: ScenarioDriver | null = null;

afterEach(() => {
	driver?.destroy();
	dkt?.destroy();
	driver = null;
	dkt = null;
});

const seeded = async (name: ScenarioName, options: ScenarioOptions = {}) => {
	const instance = createInProcessDkt();
	const scenarioDriver = createScenarioDriver(instance.pageRuntime);
	dkt = instance;
	driver = scenarioDriver;
	await seedScenario(name, scenarioDriver, options);
	const runtime = instance.pageRuntime;
	const project = await scenarioDriver.waitOne(
		await scenarioDriver.root(),
		"activeProject",
	);
	return {
		runtime,
		driver: scenarioDriver,
		project,
		attr: (scope: ReactSyncScopeHandle, name: string) =>
			scenarioDriver.waitAttr(scope, name),
		many: (scope: ReactSyncScopeHandle, rel: string) =>
			runtime.readMany(scope, rel),
	};
};

describe("scenario selection", () => {
	test("reads CLI args before env and falls back to the default", () => {
		expect(resolveScenarioSelection([], {})).toEqual({
			name: "timeline",
			options: { clipCount: undefined },
		});
		expect(
			resolveScenarioSelection(["--scenario=large", "--clips=12"], {
				MINICUT_GPUIX_SCENARIO: "empty",
			}),
		).toEqual({ name: "large", options: { clipCount: 12 } });
		expect(
			resolveScenarioSelection([], { MINICUT_GPUIX_SCENARIO: "empty" }).name,
		).toBe("empty");
	});

	test("rejects unknown scenarios and invalid clip counts", () => {
		expect(() => resolveScenarioSelection(["--scenario=nope"], {})).toThrow(
			/Unknown scenario/,
		);
		expect(() => resolveScenarioSelection(["--clips=0"], {})).toThrow(
			/Invalid clip count/,
		);
	});

	test("lists every scenario", () => {
		expect(SCENARIO_NAMES).toEqual([
			"empty",
			"timeline",
			"large",
			"unavailable-resource",
		]);
	});
});

describe("seeded scenarios", () => {
	test("empty: default tracks, no clips or resources", async () => {
		const { project, attr, many } = await seeded("empty");

		expect(await attr(project, "title")).toBe("Empty project");
		const tracks = many(project, "tracks");
		expect(await Promise.all(tracks.map((t) => attr(t, "name")))).toEqual([
			"V1",
			"A1",
		]);
		expect(many(tracks[0], "clips")).toHaveLength(0);
		expect(many(project, "resources")).toHaveLength(0);
	});

	test("timeline: three tracks, clips and ready resources", async () => {
		const { project, attr, many } = await seeded("timeline");

		const tracks = many(project, "tracks");
		expect(await Promise.all(tracks.map((t) => attr(t, "name")))).toEqual([
			"V1",
			"A1",
			"V2",
		]);
		expect(tracks.map((t) => many(t, "clips").length)).toEqual([4, 2, 2]);
		const resources = many(project, "resources");
		expect(await Promise.all(resources.map((r) => attr(r, "name")))).toEqual([
			"Interview.mp4",
			"Music.wav",
		]);
	});

	test("large: spreads the requested clip count over three tracks", async () => {
		const { project, many } = await seeded("large", { clipCount: 30 });

		const counts = many(project, "tracks").map((t) => many(t, "clips").length);
		expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
		expect(counts.every((count) => count === 10)).toBe(true);
	});

	test("unavailable-resource: the clip points at a resource without a file", async () => {
		const { project, runtime, attr, many } = await seeded("unavailable-resource");

		const [resource] = many(project, "resources");
		expect(await attr(resource, "name")).toBe("Lost footage.mov");
		expect(await attr(resource, "status")).toBe("missing");
		expect(await attr(resource, "localMediaAvailability")).toBe("unavailable");
		expect(await attr(resource, "originalAccessStatus")).toBe("missing");
		const clip = many(many(project, "tracks")[0], "clips")[0];
		expect(clip).toBeDefined();
		expect(runtime.readOne(clip, "resource")?._nodeId).toBe(resource._nodeId);
	});
});
