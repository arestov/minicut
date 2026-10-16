/**
 * One user scenario for the Web and the GPUIX desktop app, expressed as data.
 * Both platform drivers (Playwright for Web, the real host for GPUIX) walk the
 * same step list through their own runtime path and write the same artifacts
 * under `tmp/parity/<platform>/`; `webDesktopParity.compare.test.ts` compares
 * them. Nothing here touches a platform API.
 */
import type { FixtureName } from "../../src/video-editor/media/node/testing/mediaFixtures";

export type ParityPlatform = "web" | "desktop";

/** Files the scenario imports. Names are what the app shows (resource and clip names). */
export const PARITY_FILES = [
	{ name: "av.webm", fixture: "video-av-webm", mime: "video/webm" },
	{ name: "blue.webm", fixture: "video-blue-webm", mime: "video/webm" },
	{ name: "card.png", fixture: "image-card", mime: "image/png" },
	{ name: "vfr.webm", fixture: "video-vfr-webm", mime: "video/webm" },
] as const satisfies ReadonlyArray<{ name: string; fixture: FixtureName; mime: string }>;

export type ParityFileName = (typeof PARITY_FILES)[number]["name"];

/** A clip on the timeline: track name, clip name, and the n-th clip of that name on the track. */
export type ParityClipRef = { track: string; name: string; nth?: number };

export type ParityStep =
	| { op: "import"; files: readonly ParityFileName[] }
	/** Model action `addActiveProjectResourceToTimeline` for the resource with this name. */
	| { op: "addToTimeline"; resource: ParityFileName }
	/** Model action on one clip. */
	| { op: "clip"; clip: ParityClipRef; action: string; payload: unknown }
	| { op: "select"; clip: ParityClipRef }
	/** Model action on the session root (setCursor, play, pausePlayback). */
	| { op: "root"; action: string; payload?: unknown }
	/** Normalised model state, compared across platforms. */
	| { op: "checkpoint"; name: string }
	/** Sets the cursor and captures the preview picture there. */
	| { op: "frame"; name: string; time: number }
	/** Exports the whole project; the outcome (file or error) is an artifact either way. */
	| { op: "export"; name: string };

export const PARITY_STEPS: readonly ParityStep[] = [
	{ op: "import", files: ["av.webm", "blue.webm", "card.png", "vfr.webm"] },
	{ op: "checkpoint", name: "imported" },
	{ op: "addToTimeline", resource: "blue.webm" },
	{ op: "addToTimeline", resource: "card.png" },
	{ op: "addToTimeline", resource: "vfr.webm" },
	{ op: "checkpoint", name: "placed" },
	// Trim the head of av by an off-grid amount (not a multiple of 1/25 or 1/30 s).
	{ op: "clip", clip: { track: "V1", name: "av.webm" }, action: "trim", payload: { edge: "start", delta: 0.37 } },
	// Layer blue over the tail of av.
	{ op: "clip", clip: { track: "V1", name: "blue.webm" }, action: "moveBy", payload: { delta: -1 } },
	// Trim the tail of blue (the out point).
	{ op: "clip", clip: { track: "V1", name: "blue.webm" }, action: "resize", payload: { edge: "end", delta: -0.5 } },
	{ op: "clip", clip: { track: "V1", name: "vfr.webm" }, action: "trim", payload: { edge: "start", delta: 0.53 } },
	{ op: "clip", clip: { track: "A1", name: "Embedded audio", nth: 0 }, action: "setAudio", payload: { gain: 0.5 } },
	{ op: "select", clip: { track: "V1", name: "av.webm" } },
	{ op: "checkpoint", name: "edited" },
 { op: "root", action: "setActiveInspectorTab", payload: "color" },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "color", payload: { color: "#14b8a6" } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "setTransform", payload: { x: 12, y: -3, scale: 1.25, rotation: 15 } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "setFade", payload: { edge: "in", delta: 0.5 } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "setFade", payload: { edge: "out", delta: 0.5 } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "addEffect", payload: { kind: "blur", name: "Parity bypass blur", enabled: false, params: {} } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "addEffect", payload: { kind: "color-correction", name: "Parity grade A", enabled: false, params: { lookId: "custom", exposure: { value: 0.25 }, contrast: { value: 1.2 }, saturation: { value: 0.8 }, temperature: { value: -0.1 } } } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "addEffect", payload: { kind: "color-correction", name: "Parity grade B", enabled: false, params: { lookId: "custom", exposure: { value: -0.2 }, contrast: { value: 0.9 }, saturation: { value: 1.1 }, temperature: { value: 0.15 } } } },
 { op: "checkpoint", name: "inspector-color" },
 { op: "root", action: "setActiveInspectorTab", payload: "edit" },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "setTransform", payload: { x: 0, y: 0, scale: 1, rotation: 0 } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "setFade", payload: { edge: "in", delta: -0.5 } },
 { op: "clip", clip: { track: "V1", name: "av.webm" }, action: "setFade", payload: { edge: "out", delta: -0.5 } },
 { op: "checkpoint", name: "inspector-edit-restored" },
 { op: "select", clip: { track: "A1", name: "Embedded audio", nth: 0 } },
 { op: "root", action: "setActiveInspectorTab", payload: "audio" },
 { op: "clip", clip: { track: "A1", name: "Embedded audio", nth: 0 }, action: "setAudio", payload: { gain: 0.75, pan: 0.25 } },
 { op: "checkpoint", name: "inspector-audio" },
 { op: "clip", clip: { track: "A1", name: "Embedded audio", nth: 0 }, action: "setAudio", payload: { gain: 0.5, pan: 0 } },
 { op: "select", clip: { track: "V1", name: "av.webm" } },
 { op: "root", action: "setActiveInspectorTab", payload: "export" },
 { op: "checkpoint", name: "inspector-export" },
 { op: "root", action: "setActiveInspectorTab", payload: "edit" },
 { op: "checkpoint", name: "inspector-restored" },
	{ op: "root", action: "setCursor", payload: 1.2 },
	{ op: "root", action: "play" },
	{ op: "checkpoint", name: "playing" },
	{ op: "root", action: "pausePlayback", payload: { cursor: 1.6 } },
	{ op: "checkpoint", name: "paused" },
	{ op: "frame", name: "gap", time: 0.2 },
	{ op: "frame", name: "trimmed-off-grid", time: 0.9 },
	{ op: "frame", name: "layered", time: 1.5 },
	{ op: "frame", name: "top-only", time: 2.2 },
	{ op: "frame", name: "empty", time: 3.5 },
	{ op: "frame", name: "image", time: 4.5 },
	{ op: "frame", name: "vfr-trimmed", time: 6.0 },
	{ op: "frame", name: "vfr-late", time: 6.9 },
	{ op: "export", name: "opaque" },
	// Clip opacity is not supported by the Node preview and exporter yet: these steps record how
	// each platform reacts (the web renders it, the desktop reports the unsupported operation).
	{ op: "clip", clip: { track: "V1", name: "card.png" }, action: "updateOpacity", payload: { opacityPercent: 50 } },
	{ op: "checkpoint", name: "opacity" },
	{ op: "frame", name: "image-half-opacity", time: 4.5 },
	{ op: "export", name: "with-opacity" },
];

/** The picture of every fixture has this aspect; frames are compared on that box. */
export const CONTENT_ASPECT = 4 / 3;

/** Largest box of `aspect` centred inside a `width` x `height` area, in the area's pixels. */
export const containedRect = (
	width: number,
	height: number,
	aspect: number = CONTENT_ASPECT,
): { x: number; y: number; width: number; height: number } => {
	const w = Math.min(width, height * aspect);
	const h = w / aspect;
	return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
};

/** Thresholds shared by the comparison; every value is documented in docs/web-desktop-parity.md. */
export const PARITY_THRESHOLDS = {
	/** SSIM of a preview picture, Web vs desktop, compared at 320x240. */
	frameSsimMin: 0.97,
	/** SSIM of a frame of the exported files. */
	exportFrameSsimMin: 0.97,
	/** Clip/resource times may differ by this many seconds between a browser and ffprobe. */
	timeToleranceSeconds: 0.02,
	exportDurationToleranceSeconds: 0.1,
	exportFrameCountTolerance: 2,
	exportRmsToleranceDb: 1,
	exportLufsTolerance: 1,
} as const;

// ---- normalised state -----------------------------------------------------------------

export type ParityEffect = { name: string | null; kind: string | null; enabled: boolean | null; params: Record<string, unknown> | null };
export type ParityClip = {
 color: string | null;
 transform: { x: number | null; y: number | null; scale: number | null; rotation: number | null };
 effects: ParityEffect[] | null;
 correctionEffectIndices: number[] | null;
 hasColorCorrection: boolean | null;
	name: string;
	mediaKind: string | null;
	/** Name of the resource the clip plays, or null. */
	resource: string | null;
	start: number;
	in: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
	gain: number;
	pan: number;
	opacity: number;
};

export type ParitySnapshot = {
	project: { fps: number | null; width: number | null; height: number | null };
	tracks: Array<{ name: string; kind: string | null; clips: ParityClip[] }>;
	resources: Array<{ name: string; kind: string | null; duration: number | null }>;
	session: {
  activeInspectorTab: string | null;
		cursor: number | null;
		isPlaying: boolean | null;
		selectedClip: { track: string; name: string; nth: number } | null;
	};
};

type DumpNode = {
	nodeId?: unknown;
	modelName?: unknown;
	attrs?: Record<string, unknown>;
	rels?: Record<string, unknown>;
};

const round3 = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;

const idsOf = (value: unknown): string[] => {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(idsOf);
	if (value && typeof value === "object") {
		const id = (value as { nodeId?: unknown; _nodeId?: unknown }).nodeId ?? (value as { _nodeId?: unknown })._nodeId;
		return typeof id === "string" ? [id] : [];
	}
	return [];
};

/**
 * Builds the snapshot from `PageSyncRuntime.debugDumpGraph()`. Only data the
 * user sees is kept: ids, timestamps, titles, urls, asset refs, availability,
 * recovery and sync state are dropped. Attrs that have not reached the page
 * yet read as null (callers wait until `isSnapshotComplete`).
 */
export const snapshotFromGraphDump = (dump: unknown): ParitySnapshot => {
	const nodes = new Map<string, DumpNode>();
	for (const node of ((dump as { nodes?: DumpNode[] } | null)?.nodes ?? [])) {
		if (typeof node.nodeId === "string") nodes.set(node.nodeId, node);
	}
	const rootId = (dump as { rootNodeId?: unknown } | null)?.rootNodeId;
	const root = typeof rootId === "string" ? nodes.get(rootId) : undefined;
	const projectId =
		idsOf(root?.rels?.activeProject)[0] ??
		idsOf(nodes.get(idsOf(root?.rels?.pioneer)[0] ?? "")?.rels?.project)[0];
	const project = projectId ? nodes.get(projectId) : undefined;
	const attrOf = (node: DumpNode | undefined, name: string): unknown => node?.attrs?.[name];

	const resourceName = (id: string | undefined): string | null => {
		const name = id ? attrOf(nodes.get(id), "name") : null;
		return typeof name === "string" ? name : null;
	};

	const selectedId = attrOf(root, "selectedEntityId");
	let selectedClip: ParitySnapshot["session"]["selectedClip"] = null;

	const tracks = idsOf(project?.rels?.tracks).map((trackId) => {
		const track = nodes.get(trackId);
		const trackName = typeof attrOf(track, "name") === "string" ? (attrOf(track, "name") as string) : "";
		const seen = new Map<string, number>();
		const clips = idsOf(track?.rels?.clips).map((clipId): ParityClip => {
			const clip = nodes.get(clipId);
			const name = typeof attrOf(clip, "name") === "string" ? (attrOf(clip, "name") as string) : "";
			const nth = seen.get(name) ?? 0;
			seen.set(name, nth + 1);
			if (selectedId === clipId) selectedClip = { track: trackName, name, nth };
			const audio = (attrOf(clip, "audio") ?? {}) as { gain?: unknown; pan?: unknown };
			const opacity = (attrOf(clip, "opacity") ?? {}) as { value?: unknown };
			const mediaKind = attrOf(clip, "mediaKind");
   const color = attrOf(clip, "color");
   const transform = (attrOf(clip, "transform") ?? {}) as Record<string, { value?: unknown }>;
   const rawIds = Array.isArray(clip?.rels?.effects) ? idsOf(clip.rels.effects) : null;
   const correctionIds = Array.isArray(clip?.rels?.colorCorrectionEffects) ? idsOf(clip.rels.colorCorrectionEffects) : null;
   const hasCorrection = attrOf(clip, "$meta$rels$colorCorrectionEffects$exists");
   const effects = rawIds?.map(id => {
    const effect = nodes.get(id);
    const name = attrOf(effect, "name"); const kind = attrOf(effect, "kind"); const enabled = attrOf(effect, "enabled"); const params = attrOf(effect, "params");
    return { name: typeof name === "string" ? name : null, kind: typeof kind === "string" ? kind : null, enabled: typeof enabled === "boolean" ? enabled : null, params: params && typeof params === "object" && !Array.isArray(params) ? JSON.parse(JSON.stringify(params)) as Record<string, unknown> : null };
   }) ?? null;
			return {
				name,
    color: typeof color === "string" ? color : null,
    transform: { x: round3(transform.x?.value), y: round3(transform.y?.value), scale: round3(transform.scale?.value), rotation: round3(transform.rotation?.value) },
    effects, correctionEffectIndices: rawIds && correctionIds ? correctionIds.map(id => rawIds.indexOf(id)) : null,
    hasColorCorrection: typeof hasCorrection === "boolean" ? hasCorrection : null,
				mediaKind: typeof mediaKind === "string" ? mediaKind : null,
				resource: resourceName(idsOf(clip?.rels?.resource)[0]),
				start: round3(attrOf(clip, "start")) as number,
				in: round3(attrOf(clip, "in")) as number,
				duration: round3(attrOf(clip, "duration")) as number,
				fadeIn: round3(attrOf(clip, "fadeIn")) as number,
				fadeOut: round3(attrOf(clip, "fadeOut")) as number,
				gain: round3(audio.gain) as number,
				pan: round3(audio.pan) as number,
				opacity: round3(opacity.value) as number,
			};
		});
		const kind = attrOf(track, "kind");
		return { name: trackName, kind: typeof kind === "string" ? kind : null, clips };
	});

	const resources = idsOf(project?.rels?.resources)
		.map((id) => {
			const node = nodes.get(id);
			const kind = attrOf(node, "kind");
			return {
				name: resourceName(id) ?? "",
				kind: typeof kind === "string" ? kind : null,
				duration: round3(attrOf(node, "duration")),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	const playing = attrOf(root, "isPlaying");
	return {
		project: {
			fps: round3(attrOf(project, "fps")),
			width: round3(attrOf(project, "width")),
			height: round3(attrOf(project, "height")),
		},
		tracks,
		resources,
		session: {
			activeInspectorTab: typeof attrOf(root, "activeInspectorTab") === "string" ? attrOf(root, "activeInspectorTab") as string : null,
   cursor: round3(attrOf(root, "cursor")),
			isPlaying: typeof playing === "boolean" ? playing : null,
			selectedClip,
		},
	};
};

/** True once every clip and resource carries its numbers (the sync of attrs is asynchronous). */
export const isSnapshotComplete = (snapshot: ParitySnapshot): boolean =>
	snapshot.project.fps !== null &&
 ["edit", "color", "audio", "export"].includes(snapshot.session.activeInspectorTab ?? "") &&
	snapshot.resources.every((resource) => resource.name !== "" && resource.duration !== null) &&
	snapshot.tracks.every(
		(track) =>
			track.name !== "" &&
			track.clips.every(
				(clip) =>
					clip.name !== "" &&
					Number.isFinite(clip.start) &&
					Number.isFinite(clip.duration) &&
					Number.isFinite(clip.gain) &&
					Number.isFinite(clip.opacity) &&
     [clip.in, clip.fadeIn, clip.fadeOut, clip.pan].every(Number.isFinite) &&
     typeof clip.color === "string" && [clip.transform.x, clip.transform.y, clip.transform.scale, clip.transform.rotation].every(value => typeof value === "number" && Number.isFinite(value)) &&
     clip.effects !== null && clip.effects.every(effect => typeof effect.name === "string" && typeof effect.kind === "string" && typeof effect.enabled === "boolean" && effect.params !== null && typeof effect.params === "object" && !Array.isArray(effect.params)) &&
     clip.correctionEffectIndices !== null && clip.correctionEffectIndices.every(index => Number.isInteger(index) && index >= 0 && index < clip.effects!.length) &&
     new Set(clip.correctionEffectIndices).size === clip.correctionEffectIndices.length &&
     JSON.stringify(clip.correctionEffectIndices) === JSON.stringify(clip.effects.flatMap((effect, index) => effect.kind === "color-correction" ? [index] : [])) &&
     typeof clip.hasColorCorrection === "boolean" && clip.hasColorCorrection === clip.effects.some(effect => effect.kind === "color-correction"),
			),
	);

/** Reads the clip a `ParityClipRef` points to, or null. */
export const findClip = (snapshot: ParitySnapshot, ref: ParityClipRef): ParityClip | null =>
	snapshot.tracks
		.find((track) => track.name === ref.track)
		?.clips.filter((clip) => clip.name === ref.name)[ref.nth ?? 0] ?? null;

/** Node id of the clip a `ParityClipRef` points to in a graph dump, or null. */
export const clipNodeIdFromDump = (dump: unknown, ref: ParityClipRef): string | null => {
	const nodes = new Map<string, DumpNode>();
	for (const node of ((dump as { nodes?: DumpNode[] } | null)?.nodes ?? [])) {
		if (typeof node.nodeId === "string") nodes.set(node.nodeId, node);
	}
	const root = nodes.get(String((dump as { rootNodeId?: unknown } | null)?.rootNodeId));
	const projectId =
		idsOf(root?.rels?.activeProject)[0] ??
		idsOf(nodes.get(idsOf(root?.rels?.pioneer)[0] ?? "")?.rels?.project)[0];
	for (const trackId of idsOf(nodes.get(projectId ?? "")?.rels?.tracks)) {
		const track = nodes.get(trackId);
		if (track?.attrs?.name !== ref.track) continue;
		const matches = idsOf(track.rels?.clips).filter((id) => nodes.get(id)?.attrs?.name === ref.name);
		return matches[ref.nth ?? 0] ?? null;
	}
	return null;
};

/** Node id of the active project's resource with this name, or null. */
export const resourceNodeIdFromDump = (dump: unknown, name: string): string | null => {
	const nodes = new Map<string, DumpNode>();
	for (const node of ((dump as { nodes?: DumpNode[] } | null)?.nodes ?? [])) {
		if (typeof node.nodeId === "string") nodes.set(node.nodeId, node);
	}
	const root = nodes.get(String((dump as { rootNodeId?: unknown } | null)?.rootNodeId));
	const projectId =
		idsOf(root?.rels?.activeProject)[0] ??
		idsOf(nodes.get(idsOf(root?.rels?.pioneer)[0] ?? "")?.rels?.project)[0];
	return (
		idsOf(nodes.get(projectId ?? "")?.rels?.resources).find((id) => nodes.get(id)?.attrs?.name === name) ?? null
	);
};

// ---- artifacts ---------------------------------------------------------------------------

export type ParityFrameArtifact = {
	name: string;
	time: number;
	/** PNG of the preview as the platform shows it, or null when the platform could not produce it. */
	file: string | null;
	error: string | null;
	/** The platform showed its "nothing at the cursor" state instead of a picture (the web writes a text). */
	placeholder?: boolean;
	/** Box of the picture inside the PNG, in PNG pixels; null when the PNG is the picture only. */
	content: { x: number; y: number; width: number; height: number } | null;
};

export type ParityManifest = {
	platform: ParityPlatform;
	checkpoints: Record<string, ParitySnapshot>;
	frames: ParityFrameArtifact[];
	/** One entry per export step: the file (relative to the artifact directory) or the error text. */
	exports: Array<{ name: string; file: string | null; error: string | null }>;
	/** Wall time of the scenario in ms, for the report only. */
	elapsedMs: number;
};

export const MANIFEST_FILE = "manifest.json";
