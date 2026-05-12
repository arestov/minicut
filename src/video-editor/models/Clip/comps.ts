import type {
	PreviewClipSource,
	ResolvedAnimatedScalar,
} from "../../read-model/previewComps";
import {
	type EffectRenderInstruction,
	mergeEffectFilters,
} from "../../render/colorPipeline";
import { defaultClipTransform } from "./actions";
import type { TransformAttrs } from "./types";
import {
	finiteNumberOr,
	numberOr,
	objectOr,
	objectOrNull,
	stringOr,
} from "../valueGuards";

export const reduceClipRenderData = (
	clipId: unknown,
	mediaKind: unknown,
	name: unknown,
	color: unknown,
	start: unknown,
	inPoint: unknown,
	duration: unknown,
	fadeIn: unknown,
	fadeOut: unknown,
	opacity: unknown,
	transform: unknown,
	audio: unknown,
	resourceId: unknown,
	effectInstructions: unknown,
	textAttrs: unknown,
	resourceSummary: unknown,
): PreviewClipSource => {
	const effects: EffectRenderInstruction[] = Array.isArray(effectInstructions)
		? (effectInstructions.flat().filter(Boolean) as EffectRenderInstruction[])
		: [];
	const filters = mergeEffectFilters(effects);
	const res =
		objectOrNull<{
			name: string;
			kind: string;
			url: string;
			mime: string;
		}>(resourceSummary);
	const asAnimScalar = (v: unknown, fb: number): ResolvedAnimatedScalar => {
		if (v && typeof v === "object" && "value" in v)
			return v as ResolvedAnimatedScalar;
		return { value: numberOr(v, fb) };
	};
	const asTransform = (v: unknown) => {
		const t = objectOr<TransformAttrs>(v, defaultClipTransform);
		return {
			x: asAnimScalar(t.x, 0),
			y: asAnimScalar(t.y, 0),
			scale: asAnimScalar(t.scale, 1),
			rotation: asAnimScalar(t.rotation, 0),
		};
	};
	return {
		id: stringOr(clipId, ""),
		resourceId: typeof resourceId === "string" ? resourceId : null,
		name: stringOr(name, "Clip"),
		color: stringOr(color, "#2563eb"),
		resourceName: res?.name ?? stringOr(name, "Clip"),
		resourceKind: stringOr(
			mediaKind ?? res?.kind,
			"video",
		) as PreviewClipSource["resourceKind"],
		resourceUrl: res?.url ?? "",
		mime: res?.mime ?? "application/octet-stream",
		inPoint: finiteNumberOr(inPoint, 0),
		start: finiteNumberOr(start, 0),
		duration: finiteNumberOr(duration, 0),
		fadeIn: finiteNumberOr(fadeIn, 0),
		fadeOut: finiteNumberOr(fadeOut, 0),
		opacity: asAnimScalar(opacity, 1),
		transform: asTransform(transform),
		audio: objectOr(audio, { gain: 1, pan: 0 }),
		filters: filters ? [filters] : [],
		effects,
		text: objectOrNull<NonNullable<PreviewClipSource["text"]>>(textAttrs),
	};
};
