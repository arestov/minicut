import type {
	PreviewFrame,
	RenderedClip,
} from "../read-model/previewReadModel";
import { type ColorProgram, compileEffectColorProgram } from "./colorProgram";
import type { ResourceKind, TextAttrs } from "./registryTypes";

export interface PreviewLayerOperation {
	clipId: string;
	resourceId: string | null;
	resourceKind: ResourceKind;
	resourceUrl: string;
	start: number;
	sourceTime: number;
	operations: Array<
		| { type: "transform"; value: RenderedClip["transform"] }
		| { type: "effect"; value: ColorProgram[] }
		| { type: "opacity"; value: number }
		| { type: "text"; value: TextAttrs }
		| { type: "audio"; value: RenderedClip["audio"] }
	>;
}

export interface PreviewRenderPlan {
	cursor: number;
	layers: PreviewLayerOperation[];
	visualLayers: PreviewLayerOperation[];
	audioLayers: PreviewLayerOperation[];
}

export const compilePreviewLayerOperation = (
	clip: RenderedClip,
): PreviewLayerOperation => ({
	clipId: clip.id,
	resourceId: clip.resourceId,
	resourceKind: clip.resourceKind,
	resourceUrl: clip.resourceUrl,
	start: clip.start,
	sourceTime: clip.inPoint,
	operations: [
		{ type: "transform", value: clip.transform },
		...(clip.text ? [{ type: "text" as const, value: clip.text }] : []),
		...(clip.effects.length > 0
			? [
					{
						type: "effect" as const,
						value: clip.effects.map(compileEffectColorProgram),
					},
				]
			: []),
		{ type: "opacity", value: clip.opacity },
		...(clip.resourceKind === "audio"
			? [{ type: "audio" as const, value: clip.audio }]
			: []),
	],
});

export const compilePreviewRenderPlan = (
	frame: PreviewFrame,
): PreviewRenderPlan => {
	const layers = frame.renderedClips.map(compilePreviewLayerOperation);
	return {
		cursor: frame.cursor,
		layers,
		visualLayers: layers.filter((layer) => layer.resourceKind !== "audio"),
		audioLayers: layers.filter((layer) => layer.resourceKind === "audio"),
	};
};

export const getPreviewOperationValue = <T>(
	operations: PreviewLayerOperation["operations"],
	type: PreviewLayerOperation["operations"][number]["type"],
	fallback: T,
): T => {
	const operation = operations.find((item) => item.type === type);
	return operation ? (operation.value as T) : fallback;
};
