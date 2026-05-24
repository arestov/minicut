import type {
	PreviewClipSource,
	PreviewStructure,
} from "../../read-model/previewComps";

export const reduceProjectPreviewClipSources = (
	allTrackClipData: unknown,
): PreviewStructure => {
	const sources: PreviewClipSource[] = [];
	if (Array.isArray(allTrackClipData)) {
		for (const clipData of allTrackClipData) {
			if (clipData && typeof clipData === "object" && "id" in clipData) {
				sources.push(clipData as PreviewClipSource);
			}
		}
	}
	return { clipSources: sources };
};
