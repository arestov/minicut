import type {
	PreviewClipSource,
	PreviewStructure,
} from "../../read-model/previewComps";
import { normalizePreviewClipSource } from "../../read-model/previewComps";

export const reduceProjectPreviewClipSources = (
	allTrackClipData: unknown,
): PreviewStructure => {
	const sources: PreviewClipSource[] = [];
	if (Array.isArray(allTrackClipData)) {
		for (const clipData of allTrackClipData) {
			const source = normalizePreviewClipSource(clipData);
			if (source) {
				sources.push(source);
			}
		}
	}
	return { clipSources: sources };
};
