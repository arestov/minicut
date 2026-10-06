import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { ScenarioDriver } from "./scenarioDriver";

export type ScenarioOptions = {
	/** Total clip count of the `large` scenario. */
	clipCount?: number;
};

export type ScenarioDefinition = {
	description: string;
	seed(driver: ScenarioDriver, options: ScenarioOptions): Promise<void>;
};

/**
 * Every addClip is a real model action and the runtime cost grows faster than
 * linearly with the clip count (about 14 s for 200 clips, 40 s for 300), so
 * the default stays moderate; raise it with --clips=N.
 */
export const DEFAULT_LARGE_CLIP_COUNT = 200;

const readyResource = (
	name: string,
	kind: "video" | "audio" | "image",
	mime: string,
	duration: number,
	size: number,
) => ({
	name,
	kind,
	url: `http://fixture.test/${encodeURIComponent(name)}`,
	mime,
	duration,
	size,
	source: { kind: "local", ownerPeerId: "fixture-peer" },
	status: "ready",
	data: {
		status: "ready",
		chunkSize: 1024,
		chunks: {},
		ranges: { loaded: [[0, size]], requested: [] },
		loadedBytes: size,
	},
});

const CLIP_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];

const createProject = async (driver: ScenarioDriver, title: string) => {
	const root = await driver.root();
	await driver.run("createProject", { title });
	const project = await driver.waitOne(root, "activeProject");
	// createProject creates the default V1/A1 tracks through handleInit.
	const tracks = await driver.waitMany(project, "tracks", 2);
	return { project, tracks };
};

const addTrack = async (
	driver: ScenarioDriver,
	project: ReactSyncScopeHandle,
	expectedCount: number,
	attrs: { kind: "video" | "audio"; name: string },
) => {
	await driver.run("addTrack", attrs, project);
	return driver.waitMany(project, "tracks", expectedCount);
};

const clipAction = (
	scope: ReactSyncScopeHandle,
	index: number,
	mediaKind: "video" | "audio",
	start: number,
	duration: number,
	name: string,
) => ({
	actionName: "addClip",
	scope,
	payload: {
		name,
		mediaKind,
		start,
		in: 0,
		duration,
		color: CLIP_COLORS[index % CLIP_COLORS.length],
	},
});

export const SCENARIOS = {
	empty: {
		description: "Project with the default V1/A1 tracks and no clips or resources.",
		async seed(driver) {
			await createProject(driver, "Empty project");
		},
	},
	timeline: {
		description: "Three tracks with several clips and two ready resources.",
		async seed(driver) {
			const { project, tracks: defaultTracks } = await createProject(
				driver,
				"Timeline project",
			);
			const tracks = await addTrack(driver, project, 3, {
				kind: "video",
				name: "V2",
			});
			const [v1, a1] = defaultTracks;
			const v2 = tracks[2];

			await driver.run(
				"importResource",
				readyResource("Interview.mp4", "video", "video/mp4", 42, 4_800_000),
				project,
			);
			await driver.run(
				"importResource",
				readyResource("Music.wav", "audio", "audio/wav", 90, 9_000_000),
				project,
			);
			await driver.waitMany(project, "resources", 2);

			await driver.runBatch([
				clipAction(v1, 0, "video", 0, 4, "Intro"),
				clipAction(v1, 1, "video", 4, 6.5, "Interview A"),
				clipAction(v1, 2, "video", 12, 3, "B-roll"),
				clipAction(v1, 3, "video", 15, 8, "Interview B"),
				clipAction(v2, 4, "video", 2, 3, "Title card"),
				clipAction(v2, 5, "video", 14, 5, "Overlay"),
				clipAction(a1, 0, "audio", 0, 12, "Music bed"),
				clipAction(a1, 1, "audio", 12, 11, "Voice over"),
			]);
			await Promise.all([
				driver.waitMany(v1, "clips", 4),
				driver.waitMany(v2, "clips", 2),
				driver.waitMany(a1, "clips", 2),
			]);
		},
	},
	large: {
		description:
			"Hundreds of clips over three tracks to exercise culling (--clips=N).",
		async seed(driver, options) {
			const total = options.clipCount ?? DEFAULT_LARGE_CLIP_COUNT;
			const { project, tracks: defaultTracks } = await createProject(
				driver,
				"Large project",
			);
			const tracks = await addTrack(driver, project, 3, {
				kind: "video",
				name: "V2",
			});
			const lanes = [
				{ track: defaultTracks[0], kind: "video" as const, count: 0 },
				{ track: tracks[2], kind: "video" as const, count: 0 },
				{ track: defaultTracks[1], kind: "audio" as const, count: 0 },
			];
			const actions = Array.from({ length: total }, (_, index) => {
				const lane = lanes[index % lanes.length];
				const slot = lane.count++;
				return clipAction(
					lane.track,
					index,
					lane.kind,
					slot * 2.5,
					2.25,
					`Clip ${index + 1}`,
				);
			});
			await driver.runBatch(actions);
			await Promise.all(
				lanes.map((lane) => driver.waitMany(lane.track, "clips", lane.count)),
			);
		},
	},
	"unavailable-resource": {
		description:
			"A resource whose file is unavailable, used by a clip on the timeline.",
		async seed(driver) {
			const { project, tracks } = await createProject(
				driver,
				"Unavailable resource project",
			);
			const missing = {
				...readyResource("Lost footage.mov", "video", "video/quicktime", 12, 2_000_000),
				status: "missing",
				data: undefined,
			};
			await driver.run("importResource", missing, project);
			const [resource] = await driver.waitMany(project, "resources", 1);
			await driver.run(
				"setLocalMediaAxes",
				{ availability: "unavailable", originalAccess: "missing" },
				resource,
			);
			// External ids enter through $input_id: the payload is the node id.
			await driver.run("addResourceToTimeline", resource._nodeId, project);
			await driver.waitMany(tracks[0], "clips", 1);
		},
	},
} as const satisfies Record<string, ScenarioDefinition>;

export type ScenarioName = keyof typeof SCENARIOS;

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

export const DEFAULT_SCENARIO: ScenarioName = "timeline";

export const isScenarioName = (value: string): value is ScenarioName =>
	Object.hasOwn(SCENARIOS, value);

/**
 * Picks the scenario from `--scenario=<name>` / `--clips=<n>` CLI args, then
 * from MINICUT_GPUIX_SCENARIO / MINICUT_GPUIX_CLIPS, then the default.
 */
export const resolveScenarioSelection = (
	argv: readonly string[],
	env: Record<string, string | undefined>,
): { name: ScenarioName; options: ScenarioOptions } => {
	const fromArg = (flag: string) =>
		argv.find((arg) => arg.startsWith(`--${flag}=`))?.slice(flag.length + 3);
	const requested = fromArg("scenario") ?? env.MINICUT_GPUIX_SCENARIO;
	const name = requested ?? DEFAULT_SCENARIO;
	if (!isScenarioName(name)) {
		throw new Error(
			`Unknown scenario "${name}". Available: ${SCENARIO_NAMES.join(", ")}`,
		);
	}
	const clips = fromArg("clips") ?? env.MINICUT_GPUIX_CLIPS;
	const clipCount = clips === undefined ? undefined : Number(clips);
	if (clipCount !== undefined && !(Number.isInteger(clipCount) && clipCount > 0)) {
		throw new Error(`Invalid clip count "${clips}"`);
	}
	return { name, options: { clipCount } };
};

export const seedScenario = (
	name: ScenarioName,
	driver: ScenarioDriver,
	options: ScenarioOptions = {},
): Promise<void> => (SCENARIOS[name] as ScenarioDefinition).seed(driver, options);
