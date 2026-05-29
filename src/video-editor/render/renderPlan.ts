import {
	normalizePreviewClipSource,
	type PreviewClipSource,
} from "../read-model/previewComps";
import type { ResourceAttrs, ResourceKind } from "./registryTypes";
import { evaluateFadeOpacity, evaluateKeyframedScalar } from "./timing";

export interface ClipFrameOperation {
	clipId: string;
	resourceId: string;
	resourceKind: ResourceKind;
	start: number;
	duration: number;
	localTime: number;
	sourceTime: number;
	operations: Array<{
		type: "transform" | "effect" | "opacity" | "audio" | "text";
		value: unknown;
	}>;
}

export interface EvaluatedTransformAttrs {
	x: number;
	y: number;
	scale: number;
	rotation: number;
}

export interface EditframeClip {
	type: "ef-video" | "ef-image" | "ef-audio";
	id: string;
	source: string;
	start: number;
	duration: number;
	trimStart: number;
	gain?: number;
	pan?: number;
}

export interface ExportPlan {
	projectId: string;
	fps: number;
	width: number;
	height: number;
	duration: number;
	clipSources: PreviewClipSource[];
}

export const normalizeExportPlan = (plan: ExportPlan): ExportPlan => {
	const maxClipEnd = plan.clipSources.reduce((maxEnd, clipSource) => {
		const start = Number.isFinite(clipSource.start)
			? Math.max(0, clipSource.start)
			: 0;
		const duration = Number.isFinite(clipSource.duration)
			? Math.max(0, clipSource.duration)
			: 0;
		return Math.max(maxEnd, start + duration);
	}, 0);
	return maxClipEnd > plan.duration ? { ...plan, duration: maxClipEnd } : plan;
};

export const compileClipFrameOperationFromSource = (
	source: PreviewClipSource,
	time: number,
): ClipFrameOperation => {
	const normalizedSource = normalizePreviewClipSource(source) ?? source;
	const localTime = Math.max(0, time - normalizedSource.start);
	const baseOpacity = evaluateKeyframedScalar(normalizedSource.opacity, localTime);
	const opacity = evaluateFadeOpacity(
		time,
		normalizedSource.start,
		normalizedSource.duration,
		baseOpacity,
		normalizedSource.fadeIn,
		normalizedSource.fadeOut,
	);
	const transform: EvaluatedTransformAttrs = {
		x: evaluateKeyframedScalar(normalizedSource.transform.x, localTime),
		y: evaluateKeyframedScalar(normalizedSource.transform.y, localTime),
		scale: evaluateKeyframedScalar(normalizedSource.transform.scale, localTime),
		rotation: evaluateKeyframedScalar(
			normalizedSource.transform.rotation,
			localTime,
		),
	};
	return {
		clipId: normalizedSource.id,
		resourceId: normalizedSource.resourceId ?? normalizedSource.id,
		resourceKind: normalizedSource.resourceKind,
		start: normalizedSource.start,
		duration: normalizedSource.duration,
		localTime,
		sourceTime: normalizedSource.inPoint + localTime,
		operations: [
			{ type: "transform", value: transform },
			...(normalizedSource.text
				? [{ type: "text" as const, value: normalizedSource.text }]
				: []),
			...normalizedSource.effects.map((effect) => ({
				type: "effect" as const,
				value: effect,
			})),
			{ type: "opacity", value: opacity },
			...(normalizedSource.resourceKind === "audio"
				? [{ type: "audio" as const, value: normalizedSource.audio }]
				: []),
		],
	};
};

export const compileFrameOperationsFromPlan = (
	plan: ExportPlan,
	time: number,
): ClipFrameOperation[] =>
	plan.clipSources
		.map((s) => normalizePreviewClipSource(s))
		.filter((s): s is PreviewClipSource => s !== null)
		.filter((s) => time >= s.start && time < s.start + s.duration)
		.map((s) => compileClipFrameOperationFromSource(s, time));

const getEditframeTypeFromKind = (
	kind: ResourceAttrs["kind"],
): EditframeClip["type"] => {
	if (kind === "video") return "ef-video";
	if (kind === "audio") return "ef-audio";
	return "ef-image";
};

export const compileEditframeClipsFromPlan = (
	plan: ExportPlan,
): EditframeClip[] =>
	plan.clipSources
		.map((s) => normalizePreviewClipSource(s))
		.filter((s): s is PreviewClipSource => s !== null)
		.filter((s) => s.resourceKind !== "text")
		.map((s) => ({
			type: getEditframeTypeFromKind(s.resourceKind),
			id: s.id,
			source: s.resourceUrl,
			start: s.start,
			duration: s.duration,
			trimStart: s.inPoint,
			...(s.resourceKind === "audio"
				? { gain: s.audio.gain, pan: s.audio.pan }
				: {}),
		}));
