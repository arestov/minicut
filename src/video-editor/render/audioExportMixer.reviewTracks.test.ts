import { describe, expect, it } from "vitest";
import {
	type PreviewClipSource,
	reduceProjectPreviewClipSources,
} from "../read-model/previewComps";
import { getRangeClips } from "./exportRange";
import type { ExportPlan } from "./renderPlan";

const audioSource = (id: string): PreviewClipSource => ({
	id,
	resourceId: id,
	name: id,
	color: "#2563eb",
	resourceName: `${id}.wav`,
	resourceKind: "audio",
	resourceUrl: `blob:${id}`,
	mime: "audio/wav",
	inPoint: 0,
	start: 0,
	duration: 2,
	fadeIn: 0,
	fadeOut: 0,
	opacity: { value: 1 },
	transform: {
		x: { value: 0 },
		y: { value: 0 },
		scale: { value: 1 },
		rotation: { value: 0 },
	},
	audio: { gain: 1, pan: 0 },
	filters: [],
	effects: [],
	text: null,
});

describe("audio export mixer review tracks", () => {
	it("does not expose disabled review audio clips to the export mixer", () => {
		const structure = reduceProjectPreviewClipSources(
			[audioSource("normal"), audioSource("review")],
			[
				{ enabled: true, visibleInPreview: true, trackRole: "normal" },
				{
					enabled: false,
					visibleInPreview: false,
					trackRole: "currentReview",
				},
			],
		);
		const plan: ExportPlan = {
			projectId: "project",
			fps: 30,
			width: 1920,
			height: 1080,
			duration: 2,
			clipSources: structure.clipSources,
		};

		expect(
			getRangeClips(plan, { start: 0, duration: 2, clipIds: null }).map(
				(clip) => clip.id,
			),
		).toEqual(["normal"]);
	});
});
