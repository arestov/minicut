interface PreviewCanvasInitMessage {
	type: "init";
	canvas: OffscreenCanvas;
}

interface PreviewCanvasScalar {
	value: number;
	keyframes?: Array<{
		time: number;
		value: number;
		interpolation?: "linear" | "hold";
	}>;
}

interface PreviewCanvasClipSource {
	name: string;
	color: string;
	kind: string;
	filters: string[];
	text: { content: string } | null;
	start: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
	opacity: PreviewCanvasScalar;
}

interface PreviewCanvasSceneMessage {
	type: "setScene";
	clips: PreviewCanvasClipSource[];
}

interface PreviewCanvasRenderMessage {
	type: "render";
	width: number;
	height: number;
	cursor: number;
}

interface PreviewCanvasRenderedClip {
	name: string;
	color: string;
	kind: string;
	filters: string[];
	text: { content: string } | null;
	opacity: number;
}

type PreviewCanvasMessage =
	| PreviewCanvasInitMessage
	| PreviewCanvasSceneMessage
	| PreviewCanvasRenderMessage;

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let clipSources: PreviewCanvasClipSource[] = [];

const interpolateLinear = (
	from: number,
	to: number,
	progress: number,
): number => from + (to - from) * Math.min(1, Math.max(0, progress));

const evaluateScalar = (scalar: PreviewCanvasScalar, time: number): number => {
	const keyframes = [...(scalar.keyframes ?? [])]
		.filter(
			(keyframe) =>
				Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
		)
		.sort((left, right) => left.time - right.time);
	if (keyframes.length === 0) {
		return scalar.value;
	}

	if (time <= keyframes[0].time) {
		return keyframes[0].value;
	}

	const last = keyframes[keyframes.length - 1];
	if (time >= last.time) {
		return last.value;
	}

	for (let index = 0; index < keyframes.length - 1; index += 1) {
		const from = keyframes[index];
		const to = keyframes[index + 1];
		if (time >= from.time && time <= to.time) {
			return from.interpolation === "hold" || from.time === to.time
				? from.value
				: interpolateLinear(
						from.value,
						to.value,
						(time - from.time) / (to.time - from.time),
					);
		}
	}

	return scalar.value;
};

const evaluateFadeOpacity = (
	time: number,
	clip: PreviewCanvasClipSource,
): number => {
	if (time < clip.start || time >= clip.start + clip.duration) {
		return 0;
	}

	const localTime = time - clip.start;
	const baseOpacity = evaluateScalar(clip.opacity, localTime);
	const fadeInMultiplier =
		clip.fadeIn > 0 ? Math.min(1, Math.max(0, localTime / clip.fadeIn)) : 1;
	const fadeOutStart = clip.duration - clip.fadeOut;
	const fadeOutMultiplier =
		clip.fadeOut > 0 && localTime > fadeOutStart
			? Math.min(1, Math.max(0, (clip.duration - localTime) / clip.fadeOut))
			: 1;

	return baseOpacity * Math.min(fadeInMultiplier, fadeOutMultiplier);
};

const renderClipsAtCursor = (cursor: number): PreviewCanvasRenderedClip[] =>
	clipSources
		.map((clip) => ({
			name: clip.name,
			color: clip.color,
			kind: clip.kind,
			filters: clip.filters,
			text: clip.text,
			opacity: evaluateFadeOpacity(cursor, clip),
		}))
		.filter((clip) => clip.opacity > 0);

const drawPreview = (
	ctx: OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	cursor: number,
	clips: PreviewCanvasRenderedClip[],
): void => {
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = "#27272a";
	ctx.fillRect(0, 0, width, height);

	const gradient = ctx.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, "rgba(255,255,255,0.16)");
	gradient.addColorStop(0.48, "rgba(255,255,255,0.02)");
	gradient.addColorStop(1, "rgba(37,99,235,0.2)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);

	ctx.strokeStyle = "rgba(244,244,245,0.28)";
	ctx.lineWidth = 1;
	ctx.setLineDash([6, 6]);
	ctx.strokeRect(10, 10, width - 20, height - 20);
	ctx.setLineDash([]);

	ctx.fillStyle = "#f4f4f5";
	ctx.font = "600 14px Inter, Segoe UI, sans-serif";
	ctx.fillText(`Cursor ${cursor.toFixed(1)}s`, 22, 32);

	if (clips.length === 0) {
		return;
	}

	clips.forEach((clip, index) => {
		const y = 54 + index * 28;
		ctx.globalAlpha = Math.max(0.2, clip.opacity);
		ctx.filter = clip.filters.join(" ") || "none";
		ctx.fillStyle = clip.color;
		ctx.fillRect(22, y, Math.min(width - 44, 260), 20);
		ctx.filter = "none";
		ctx.globalAlpha = 1;
		ctx.fillStyle = "#18181b";
		ctx.font = "600 12px Inter, Segoe UI, sans-serif";
		ctx.fillText(
			`${clip.kind}: ${clip.text?.content ?? clip.name}`,
			30,
			y + 14,
		);
	});
};

self.onmessage = (event: MessageEvent<PreviewCanvasMessage>) => {
	const message = event.data;
	if (message.type === "init") {
		canvas = message.canvas;
		context = canvas.getContext("2d");
		return;
	}
	if (message.type === "setScene") {
		clipSources = message.clips;
		return;
	}

	if (!canvas || !context) {
		return;
	}

	canvas.width = message.width;
	canvas.height = message.height;
	drawPreview(
		context,
		message.width,
		message.height,
		message.cursor,
		renderClipsAtCursor(message.cursor),
	);
};
