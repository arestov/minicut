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
