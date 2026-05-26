import { describe, expect, it } from "vitest";
import {
	type PreviewClipSource,
	reduceProjectPreviewClipSources,
} from "./previewComps";

const clip = (id: string): PreviewClipSource =>
	({
		id,
		name: id,
		resourceId: id,
		resourceKind: "video",
		resourceUrl: `blob:${id}`,
		duration: 1,
		start: 0,
	} as PreviewClipSource);

describe("preview comps review tracks", () => {
	it("excludes clips from disabled preview lanes", () => {
		const structure = reduceProjectPreviewClipSources(
			[clip("normal"), clip("review")],
			[
				{ enabled: true, visibleInPreview: true, trackRole: "normal" },
				{
					enabled: false,
					visibleInPreview: false,
					trackRole: "incomingReview",
				},
			],
		);

		expect(structure.clipSources.map((source) => source.id)).toEqual([
			"normal",
		]);
	});

	it("includes review track clips deterministically when preview is enabled", () => {
		const structure = reduceProjectPreviewClipSources(
			[clip("review")],
			[
				{
					enabled: true,
					visibleInPreview: true,
					trackRole: "currentReview",
				},
			],
		);

		expect(structure.clipSources.map((source) => source.id)).toEqual([
			"review",
		]);
	});
});
