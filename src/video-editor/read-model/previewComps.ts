import type { TextAttrs } from "../models/Text/types";
import type { EffectRenderInstruction } from "../render/colorPipeline";
import type {
	EntityId,
	ResourceAttrs,
	ResourceKind,
} from "../render/registryTypes";
import type { ScalarKeyframe } from "../render/timing";
import { evaluateFadeOpacity, evaluateKeyframedScalar } from "../render/timing";

export interface TimelineClipInterval {
	id: EntityId;
	trackId: EntityId;
	trackKind: ResourceAttrs["kind"];
	trackMuted: boolean;
	start: number;
	end: number;
}

export interface RenderedClip {
	id: string;
	resourceId: string | null;
	name: string;
	color: string;
	resourceName: string;
	resourceKind: ResourceAttrs["kind"];
	resourceUrl: string;
	mime: string;
	inPoint: number;
	start: number;
	opacity: number;
	transform: { x: number; y: number; scale: number; rotation: number };
	audio: { gain: number; pan: number };
	filters: string[];
	effects: EffectRenderInstruction[];
	text: TextAttrs | null;
}

export interface ResolvedAnimatedScalar {
	value: number;
	keyframes?: ScalarKeyframe[];
}

/** Where the resource file comes from, as declared by the Resource model. */
export interface ResourceSourceRef {
	sourceKind: string | null;
	sourceRef: string | null;
	contentFingerprint: string | null;
	fingerprintVersion: string | null;
}

export interface PreviewClipSource {
	id: string;
	resourceId: string | null;
	name: string;
	color: string;
	resourceName: string;
	resourceKind: ResourceAttrs["kind"];
	resourceUrl: string;
	mime: string;
	inPoint: number;
	start: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
	opacity: ResolvedAnimatedScalar;
	transform: {
		x: ResolvedAnimatedScalar;
		y: ResolvedAnimatedScalar;
		scale: ResolvedAnimatedScalar;
		rotation: ResolvedAnimatedScalar;
	};
	audio: { gain: number; pan: number };
	filters: string[];
	effects: EffectRenderInstruction[];
	text: TextAttrs | null;
	/** Source of the clip resource; absent for clips without a resource. */
	resourceSource?: ResourceSourceRef;
}

export interface PreviewStructure {
	clipSources: PreviewClipSource[];
}

const asObject = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;

const stringOr = (value: unknown, fallback: string): string =>
	typeof value === "string" ? value : fallback;

const finiteNumberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeResourceKind = (value: unknown): ResourceKind => {
	if (
		value === "video" ||
		value === "audio" ||
		value === "image" ||
		value === "text"
	) {
		return value;
	}
	return "video";
};

const normalizeScalarKeyframes = (value: unknown): ScalarKeyframe[] | undefined => {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const keyframes = value
		.map((item): ScalarKeyframe | null => {
			const keyframe = asObject(item);
			const time = finiteNumberOr(keyframe?.time, Number.NaN);
			const keyframeValue = finiteNumberOr(keyframe?.value, Number.NaN);
			if (!Number.isFinite(time) || !Number.isFinite(keyframeValue)) {
				return null;
			}
			return {
				time,
				value: keyframeValue,
				...(keyframe?.interpolation === "hold"
					? { interpolation: "hold" as const }
					: {}),
			};
		})
		.filter((keyframe): keyframe is ScalarKeyframe => keyframe !== null);
	return keyframes.length > 0 ? keyframes : undefined;
};

export const normalizeResolvedAnimatedScalar = (
	value: unknown,
	fallback: number,
): ResolvedAnimatedScalar => {
	const scalar = asObject(value);
	if (!scalar) {
		return { value: finiteNumberOr(value, fallback) };
	}
	const keyframes = normalizeScalarKeyframes(scalar.keyframes);
	return {
		value: finiteNumberOr(scalar.value, fallback),
		...(keyframes ? { keyframes } : {}),
	};
};

const normalizePreviewClipTransform = (
	value: unknown,
): PreviewClipSource["transform"] => {
	const transform = asObject(value);
	return {
		x: normalizeResolvedAnimatedScalar(transform?.x, 0),
		y: normalizeResolvedAnimatedScalar(transform?.y, 0),
		scale: normalizeResolvedAnimatedScalar(transform?.scale, 1),
		rotation: normalizeResolvedAnimatedScalar(transform?.rotation, 0),
	};
};

const normalizeAudio = (value: unknown): PreviewClipSource["audio"] => {
	const audio = asObject(value);
	return {
		gain: finiteNumberOr(audio?.gain, 1),
		pan: finiteNumberOr(audio?.pan, 0),
	};
};

const normalizeResourceSource = (value: unknown): ResourceSourceRef | undefined => {
	const source = asObject(value);
	if (!source) return undefined;
	const text = (field: unknown): string | null =>
		typeof field === "string" && field ? field : null;
	return {
		sourceKind: text(source.sourceKind),
		sourceRef: text(source.sourceRef),
		contentFingerprint: text(source.contentFingerprint),
		fingerprintVersion: text(source.fingerprintVersion),
	};
};

const normalizeTextAttrs = (value: unknown): TextAttrs | null =>
	value && typeof value === "object" ? (value as TextAttrs) : null;

export const normalizePreviewClipSource = (
	value: unknown,
): PreviewClipSource | null => {
	const clip = asObject(value);
	const id = stringOr(clip?.id, "");
	if (!clip || !id) {
		return null;
	}
	const name = stringOr(clip.name, "Clip");
	const resourceKind = normalizeResourceKind(clip.resourceKind);
	const effects = Array.isArray(clip.effects)
		? (clip.effects.filter(Boolean) as EffectRenderInstruction[])
		: [];
	return {
		id,
		resourceId: typeof clip.resourceId === "string" ? clip.resourceId : null,
		name,
		color: stringOr(clip.color, "#2563eb"),
		resourceName: stringOr(clip.resourceName, name),
		resourceKind,
		resourceUrl: stringOr(clip.resourceUrl, ""),
		mime: stringOr(clip.mime, "application/octet-stream"),
		inPoint: finiteNumberOr(clip.inPoint, 0),
		start: finiteNumberOr(clip.start, 0),
		duration: finiteNumberOr(clip.duration, 0),
		fadeIn: finiteNumberOr(clip.fadeIn, 0),
		fadeOut: finiteNumberOr(clip.fadeOut, 0),
		opacity: normalizeResolvedAnimatedScalar(clip.opacity, 1),
		transform: normalizePreviewClipTransform(clip.transform),
		audio: normalizeAudio(clip.audio),
		filters: Array.isArray(clip.filters)
			? clip.filters.filter((filter): filter is string => typeof filter === "string")
			: [],
		effects,
		text: normalizeTextAttrs(clip.text),
		...(normalizeResourceSource(clip.resourceSource)
			? { resourceSource: normalizeResourceSource(clip.resourceSource) }
			: null),
	};
};

export const reduceProjectPreviewClipSources = (
	allTrackClipData: unknown,
	allClipTrackState?: unknown,
): PreviewStructure => {
	const sources: PreviewClipSource[] = [];
	if (!Array.isArray(allTrackClipData)) {
		return { clipSources: sources };
	}
	for (let index = 0; index < allTrackClipData.length; index += 1) {
		const laneState = Array.isArray(allClipTrackState)
			? allClipTrackState[index]
			: null;
		if (
			laneState &&
			typeof laneState === "object" &&
			((laneState as { enabled?: unknown }).enabled === false ||
				(laneState as { visibleInPreview?: unknown }).visibleInPreview === false)
		) {
			continue;
		}
		const clipData = allTrackClipData[index];
		const source = normalizePreviewClipSource(clipData);
		if (source) {
			sources.push(source);
		}
	}
	return { clipSources: sources };
};

export interface PreviewScene {
	cursor: number;
	isPlaying: boolean;
	renderedClips: RenderedClip[];
	visualRenderedClips: RenderedClip[];
	audioRenderedClips: RenderedClip[];
	activeClipNames: string[];
	canvasClips: Array<{
		name: string;
		color: string;
		kind: ResourceAttrs["kind"];
		opacity: number;
	}>;
}

export interface PreviewFrame {
	cursor: number;
	renderedClips: RenderedClip[];
	visualRenderedClips: RenderedClip[];
	audioRenderedClips: RenderedClip[];
	activeClipNames: string[];
}

export const renderPreviewClipSourceAtCursor = (
	clip: PreviewClipSource,
	cursor: number,
): RenderedClip | null => {
	const source = normalizePreviewClipSource(clip);
	if (!source || cursor < source.start || cursor >= source.start + source.duration) {
		return null;
	}

	const localTime = Math.max(0, cursor - source.start);
	const baseOpacity = evaluateKeyframedScalar(source.opacity, localTime);

	return {
		id: source.id,
		resourceId: source.resourceId,
		name: source.name,
		color: source.color,
		resourceName: source.resourceName,
		resourceKind: source.resourceKind,
		resourceUrl: source.resourceUrl,
		mime: source.mime,
		inPoint: source.inPoint,
		start: source.start,
		opacity: evaluateFadeOpacity(
			cursor,
			source.start,
			source.duration,
			baseOpacity,
			source.fadeIn,
			source.fadeOut,
		),
		transform: {
			x: evaluateKeyframedScalar(source.transform.x, localTime),
			y: evaluateKeyframedScalar(source.transform.y, localTime),
			scale: evaluateKeyframedScalar(source.transform.scale, localTime),
			rotation: evaluateKeyframedScalar(source.transform.rotation, localTime),
		},
		audio: source.audio,
		filters: source.filters,
		effects: source.effects,
		text: source.text,
	};
};

export const renderPreviewStructureAtCursor = (
	structure: PreviewStructure,
	cursor: number,
): RenderedClip[] =>
	structure.clipSources
		.map((clip) => renderPreviewClipSourceAtCursor(clip, cursor))
		.filter((clip): clip is RenderedClip => clip !== null);

export const createPreviewFrame = (
	structure: PreviewStructure,
	cursor: number,
): PreviewFrame => {
	const renderedClips = renderPreviewStructureAtCursor(structure, cursor);
	const visualRenderedClips = renderedClips.filter(
		(clip) => clip.resourceKind !== "audio",
	);
	const audioRenderedClips = renderedClips.filter(
		(clip) => clip.resourceKind === "audio",
	);

	return {
		cursor,
		renderedClips,
		visualRenderedClips,
		audioRenderedClips,
		activeClipNames: renderedClips.map((clip) => clip.name),
	};
};

// ---------------------------------------------------------------------------
// Preview buffer — pre-computed frames for smooth playback
// ---------------------------------------------------------------------------

export interface PreviewBuffer {
	frames: PreviewFrame[];
	startCursor: number;
	fps: number;
	endCursor: number;
}

export const PREVIEW_BUFFER_FPS = 30;
export const PREVIEW_BUFFER_LOOKAHEAD_SECONDS = 2;
export const PREVIEW_BUFFER_REFILL_THRESHOLD_SECONDS = 0.5;

export const buildPreviewBuffer = (
	structure: PreviewStructure,
	startCursor: number,
	fps: number = PREVIEW_BUFFER_FPS,
	lookaheadSeconds: number = PREVIEW_BUFFER_LOOKAHEAD_SECONDS,
): PreviewBuffer => {
	const frameCount = Math.ceil(fps * lookaheadSeconds);
	const step = 1 / fps;
	const frames: PreviewFrame[] = [];
	for (let i = 0; i < frameCount; i++) {
		frames.push(createPreviewFrame(structure, startCursor + i * step));
	}
	return {
		frames,
		startCursor,
		fps,
		endCursor: startCursor + frameCount * step,
	};
};

export const lookupPreviewBufferFrame = (
	buffer: PreviewBuffer | null | undefined,
	cursor: number,
): PreviewFrame | null => {
	if (!buffer || cursor < buffer.startCursor || cursor >= buffer.endCursor) {
		return null;
	}
	const index = Math.round((cursor - buffer.startCursor) * buffer.fps);
	return buffer.frames[index] ?? null;
};
