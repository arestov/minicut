import { describe, expect, it } from "vitest";
import {
	createPreviewFrame,
	type PreviewClipSource,
	reduceProjectPreviewClipSources,
} from "../read-model/previewComps";
import { compilePreviewRenderPlan } from "./previewRenderPlan";

const source = (id: string): PreviewClipSource => ({
	id,
	resourceId: id,
	name: id,
	color: "#2563eb",
	resourceName: `${id}.webm`,
	resourceKind: "video",
	resourceUrl: `blob:${id}`,
	mime: "video/webm",
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

describe("preview render plan review tracks", () => {
	it("does not produce video layers for disabled review tracks", () => {
		const structure = reduceProjectPreviewClipSources(
			[source("normal"), source("incoming")],
			[
				{ enabled: true, visibleInPreview: true, trackRole: "normal" },
				{
					enabled: false,
					visibleInPreview: false,
					trackRole: "incomingReview",
				},
			],
		);
		const plan = compilePreviewRenderPlan(createPreviewFrame(structure, 0.5));

		expect(plan.visualLayers.map((layer) => layer.clipId)).toEqual(["normal"]);
	});
});
