import type { PreviewClipSource } from "../../../read-model/previewComps";
import type { ExportPlan } from "../../../render/renderPlan";
import type { AssetLocations } from "../../contracts/assets";
import type { FixtureName } from "./mediaFixtures";

/**
 * Shared export scenario description: a render plan plus the fixture each
 * resource id maps to. Used by the Node export tests and (later) by the
 * Web-vs-Node differential test so both targets render identical inputs.
 */
export interface ExportScenario {
	name: string;
	plan: ExportPlan;
	/** resourceId -> fixture name */
	resources: Record<string, FixtureName>;
}

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	({
		name: "Clip",
		inPoint: 0,
		...partial,
	}) as unknown as PreviewClipSource;

/** Two sequential 1s video segments plus a 2s tone; 320x240 @ 25fps, 2s. */
export const videoAudioScenario: ExportScenario = {
	name: "video-audio-sequence",
	resources: {
		"res-video": "video-cfr",
		"res-tone": "audio-tone",
	},
	plan: {
		projectId: "scenario-1",
		fps: 25,
		width: 320,
		height: 240,
		duration: 2,
		clipSources: [
			clip({
				id: "clip-a",
				resourceId: "res-video",
				resourceKind: "video",
				start: 0,
				duration: 1,
				inPoint: 0.5,
			}),
			clip({
				id: "clip-b",
				resourceId: "res-video",
				resourceKind: "video",
				start: 1,
				duration: 1,
				inPoint: 0,
			}),
			clip({
				id: "clip-tone",
				resourceId: "res-tone",
				resourceKind: "audio",
				start: 0,
				duration: 2,
				audio: { gain: 0.5, pan: 0 },
			}),
		],
	},
};

export const scenarioAssets = (
	scenario: ExportScenario,
	fixturePaths: Record<FixtureName, string>,
): AssetLocations =>
	Object.fromEntries(
		Object.entries(scenario.resources).map(([resourceId, fixture]) => [
			resourceId,
			{ path: fixturePaths[fixture] },
		]),
	);

/**
 * Scenario shared by the Web (Playwright, WebCodecs) and Node (FFmpeg) export
 * targets: one imported VP9/Opus clip with its embedded audio, full length.
 * The web app derives the equivalent plan itself when the file is imported
 * (video clip + linked audio clip on one resource), so only the fixture is
 * shared; the Node half uses this explicit plan.
 */
export const webCompareScenario: ExportScenario = {
	name: "web-compare-av",
	resources: { "res-av": "video-av-webm" },
	plan: {
		projectId: "web-compare",
		fps: 25,
		width: 320,
		height: 240,
		duration: 2,
		clipSources: [
			clip({
				id: "clip-av-video",
				resourceId: "res-av",
				resourceKind: "video",
				start: 0,
				duration: 2,
			}),
			clip({
				id: "clip-av-audio",
				resourceId: "res-av",
				resourceKind: "audio",
				start: 0,
				duration: 2,
			}),
		],
	},
};

/**
 * Second shared scenario: overlapping video clips (layer order), a trimmed
 * clip (in-point) and a mono audio source. The Playwright spec builds the same
 * timeline through the web UI and asserts the web timeline equals these
 * numbers before exporting, so both targets render identical inputs.
 *
 *   V1: av.webm  start 0.5 in 0.5 dur 1.5   (Start +0.5s trim)
 *       blue.webm start 1.0 in 0 dur 2.0   (nudged twice, on top of av)
 *   A1: av embedded audio 0..2.008, mono tone.wav 4.008..7.008
 * (blue's embedded audio clip is omitted: the source has no audio stream.)
 */
export const webLayeringScenario: ExportScenario = {
	name: "web-layering-trim-mono",
	resources: {
		"res-av": "video-av-webm",
		"res-blue": "video-blue-webm",
		"res-tone": "audio-tone",
	},
	plan: {
		projectId: "web-layering",
		fps: 25,
		width: 320,
		height: 240,
		duration: 7.008,
		clipSources: [
			clip({
				id: "av-video",
				resourceId: "res-av",
				resourceKind: "video",
				start: 0.5,
				duration: 1.5,
				inPoint: 0.5,
			}),
			clip({
				id: "blue-video",
				resourceId: "res-blue",
				resourceKind: "video",
				start: 1,
				duration: 2,
			}),
			clip({
				id: "av-audio",
				resourceId: "res-av",
				resourceKind: "audio",
				start: 0,
				duration: 2.008,
			}),
			clip({
				id: "tone-audio",
				resourceId: "res-tone",
				resourceKind: "audio",
				start: 4.008,
				duration: 3,
			}),
		],
	},
};

/** Expected web timeline: [track, clip name, start, in, duration]. */
export const webLayeringTimeline: Array<[string, string, number, number, number]> = [
	["V1", "av.webm", 0.5, 0.5, 1.5],
	["V1", "blue.webm", 1, 0, 2],
	["A1", "tone.wav", 4.008, 0, 3],
];
