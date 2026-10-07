import type { ExportProgressState } from "../../app/exportProgressState";
import { clampProgressPercent, isExportRunning } from "../../app/exportProgressState";
import type { ExportRequestState } from "../../app/exportRequestState";
import {
	buildPreviewBuffer,
	type PreviewBuffer,
	type PreviewClipSource,
	type PreviewStructure,
} from "../../read-model/previewComps";
import { type ExportPlan, normalizeExportPlan } from "../../render/renderPlan";
import { WORKSPACE_OPEN_STATUS } from "../../dkt/runtime/workspaceOpenState";
import { PROJECT_CREATION_SHAPE } from "../Project";

/** Inline session state patch type – replaces legacy EditorSessionState from domain/types. */
type SessionStateFields = {
	pendingProjectInit: Record<string, unknown> | null;
	selectedEntityId: string | null;
	cursor: number;
	playbackIntent: "paused" | "playing";
	playbackRunId: number;
	playStartCursor: number;
	playStartedAt: number;
	playbackRate: number;
	playbackBoundaryCursor: number;
	exportRequest: ExportRequestState | null;
	exportProgress: ExportProgressState | null;
	timelineZoom: number;
	activeInspectorTab: "edit" | "color" | "audio" | "export";
	previewBuffer: PreviewBuffer | null;
};

type CreateProjectPayload = {
	title?: unknown;
	fps?: unknown;
	width?: unknown;
	height?: unknown;
	duration?: unknown;
	createdAt?: unknown;
	updatedAt?: unknown;
	tracks?: unknown;
};

export type DktSessionActionName =
	| "handleInit"
	| "createProject"
	| "selectEntity"
	| "setActiveProject"
	| "syncActiveProjectRel"
	| "syncPreviewModel"
	| "syncSelectedClipTrackPosition"
	| "syncSelectedClipSummary"
	| "setActiveInspectorTab"
	| "setCursor"
	| "play"
	| "pausePlayback"
	| "commitSeek"
	| "setPlaybackRate"
	| "completePlayback"
	| "setTimelineZoom"
	| "addTextClipToTimeline"
	| "requestImportFiles"
	| "setActiveProjectImportProgress"
	| "importResourceIntoActiveProject"
	| "addActiveProjectResourceToTimeline"
	| "addActiveProjectEmbeddedAudioToTimeline"
	| "syncSelectedClipRel"
	| "handleAttr:isPlaying"
	| "handleAttr:playbackBoundaryCursor"
	| "zoomTimeline"
	| "nudgeSelectedClip"
	| "deleteSelectedClip"
	| "splitSelectedClip"
	| "startPreviewBuffer"
	| "clearPreviewBuffer"
	| "requestProjectExport"
	| "requestClipExport"
	| "requestSelectedClipExport"
	| "consumeExportRequest"
	| "cancelExport"
	| "setExportProgress"
	| "clearExportProgress";

export type DktSessionActionPatch = Partial<
	Pick<
		SessionStateFields,
		| "selectedEntityId"
		| "cursor"
		| "playbackIntent"
		| "timelineZoom"
		| "activeInspectorTab"
		| "previewBuffer"
	>
>;

type DktActionDescriptor = {
	aggregate?: unknown;
	to: unknown;
	when_deps?: readonly string[];
	when_fn?: (...args: unknown[]) => boolean;
	fn:
		| ((payload: unknown) => unknown)
		| readonly [
				readonly string[],
				(payload: unknown, ...deps: unknown[]) => unknown,
		  ]
};

type DktActionWithSteps = {
	aggregate?: unknown;
	steps: readonly DktActionDescriptor[];
};

type DktActionDefinition =
	| DktActionDescriptor
	| DktActionWithSteps
	| readonly DktActionDescriptor[];

export const roundToHundredths = (value: number): number =>
	Math.round(value * 100) / 100;
export const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const finiteNumber = (payload: unknown): number | null => {
	const value = typeof payload === "number" ? payload : Number(payload);
	return Number.isFinite(value) ? value : null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value ? value : null;
const asNumber = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeExportRange = (
	value: unknown,
): ExportProgressState["range"] | null => {
	if (!value || typeof value !== "object") {
		return null;
	}
	const range = value as { type?: unknown; clipId?: unknown };
	if (range.type === "project") {
		return { type: "project" };
	}
	if (
		range.type === "clip" &&
		typeof range.clipId === "string" &&
		range.clipId
	) {
		return { type: "clip", clipId: range.clipId };
	}
	return null;
};

const normalizeExportStage = (
	value: unknown,
): ExportProgressState["stage"] | null => {
	if (
		value === "idle" ||
		value === "queued" ||
		value === "rendering" ||
		value === "finalizing" ||
		value === "done" ||
		value === "cancelled" ||
		value === "error"
	) {
		return value;
	}
	return null;
};

const reduceSessionSetExportProgressAction = (
	payload: unknown,
	nowValue: unknown,
	noop: unknown,
	exportProgress: unknown,
	exportRequest: unknown,
): Pick<SessionStateFields, "exportProgress"> | unknown => {
	if (payload === null) {
		return { exportProgress: null };
	}

	const now = asNumber(nowValue, 0);
	const value = asObject(payload);
	const payloadId = asString(value?.id);
	const currentId =
		asString(asObject(exportProgress)?.id) ??
		asString(asObject(exportRequest)?.id);
	// Late progress of a superseded or dismissed export must not overwrite the current one.
	if (!payloadId || payloadId !== currentId) {
		return noop;
	}
	// A cancelled export stays cancelled: its executor may still report once.
	if (asObject(exportProgress)?.stage === "cancelled") {
		return noop;
	}
	const range = normalizeExportRange(value?.range);
	const stage = normalizeExportStage(value?.stage);
	if (!value || !range || !stage) {
		return { exportProgress: null };
	}

	const progressFallback = stage === "done" ? 100 : 0;
	return {
		exportProgress: {
			id: payloadId,
			range,
			stage,
			progress: clampProgressPercent(value.progress, progressFallback),
			updatedAt: asNumber(value.updatedAt, now),
			initiatedBy: asString(value.initiatedBy),
			fileName: asString(value.fileName) ?? undefined,
			size:
				typeof value.size === "number" && Number.isFinite(value.size)
					? value.size
					: undefined,
			frameCount:
				typeof value.frameCount === "number" &&
				Number.isFinite(value.frameCount)
					? value.frameCount
					: undefined,
			error: asString(value.error) ?? undefined,
		},
	};
};

const normalizePreviewClipSources = (value: unknown): PreviewClipSource[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((clipSource): clipSource is PreviewClipSource => {
		if (!clipSource || typeof clipSource !== "object") {
			return false;
		}
		return typeof (clipSource as { id?: unknown }).id === "string";
	});
};

const buildExportPlan = (
	projectId: unknown,
	fps: unknown,
	width: unknown,
	height: unknown,
	duration: unknown,
	clipSources: unknown,
): ExportPlan | null => {
	const normalizedProjectId = asString(projectId);
	if (!normalizedProjectId) {
		return null;
	}

	return normalizeExportPlan({
		projectId: normalizedProjectId,
		fps: asNumber(fps, 30),
		width: asNumber(width, 1920),
		height: asNumber(height, 1080),
		duration: Math.max(0, asNumber(duration, 0)),
		clipSources: normalizePreviewClipSources(clipSources),
	});
};

const createQueuedProgressState = (
	id: string,
	range: ExportProgressState["range"],
	initiatedBy: string | null,
	now: number,
): ExportProgressState => ({
	id,
	range,
	stage: "queued",
	progress: 0,
	updatedAt: now,
	initiatedBy,
});

type ExportFxPayload = {
	request: ExportRequestState;
	queueKey: string;
};

type ImportFilesFxPayload = {
	projectId: string;
	inputBatchHandleId: string;
	addToTimelineWhenEmpty: true;
};

const _normalizeInitialTrack = (value: unknown) => {
	const track = asObject(value);
	const kind = track?.kind === "audio" ? "audio" : "video";
	return {
		kind,
		name: asString(track?.name) ?? (kind === "audio" ? "A1" : "V1"),
		muted: typeof track?.muted === "boolean" ? track.muted : false,
		locked: typeof track?.locked === "boolean" ? track.locked : false,
		height: asNumber(track?.height, kind === "audio" ? 64 : 72),
	};
};

const _createDefaultTracks = () => [
	{
		kind: "video",
		name: "V1",
		muted: false,
		locked: false,
		height: 72,
	},
	{
		kind: "audio",
		name: "A1",
		muted: false,
		locked: false,
		height: 64,
	},
];

/** Next "Project N": max N among existing titles + 1 (pure; no hidden counter). */
export const getNextProjectIndex = (projectTitles: unknown): number => {
	const titleList = Array.isArray(projectTitles) ? projectTitles : [];
	let maxIndex = 0;
	for (const value of titleList) {
		if (typeof value !== "string") {
			continue;
		}
		const match = value.match(/^Project\s+(\d+)$/i);
		if (!match) {
			continue;
		}
		const parsed = Number.parseInt(match[1], 10);
		if (Number.isFinite(parsed) && parsed > maxIndex) {
			maxIndex = parsed;
		}
	}
	return maxIndex + 1;
};

const createProjectSeedPayload = (
	payload: unknown,
	forcedProjectId?: string,
	projectTitles?: unknown,
	nowValue?: unknown,
) => {
	const value = asObject(payload) as CreateProjectPayload | null;
	const nextSequence = forcedProjectId
		? 1
		: getNextProjectIndex(projectTitles);
	const now = asNumber(nowValue, 0);
	return {
		title: asString(value?.title) ?? `Project ${nextSequence}`,
		fps: asNumber(value?.fps, 30),
		width: asNumber(value?.width, 1920),
		height: asNumber(value?.height, 1080),
		duration: asNumber(value?.duration, 0),
		createdAt: asNumber(value?.createdAt, now),
		updatedAt: asNumber(value?.updatedAt, now),
		autoCreateDefaultTracks: true,
	};
};

export const reduceSessionSelectEntityAction = (
	payload: unknown,
): Pick<SessionStateFields, "selectedEntityId"> => ({
	selectedEntityId: typeof payload === "string" ? payload : null,
});

export const reduceSessionSetActiveProjectAction = (
	_payload: unknown,
): Pick<SessionStateFields, "selectedEntityId" | "cursor"> => ({
	selectedEntityId: null,
	cursor: 0,
});

export const reduceSessionSetCursorAction = (
	payload: unknown,
): Pick<SessionStateFields, "cursor"> | null => {
	const value = finiteNumber(payload);
	return value === null
		? null
		: { cursor: Math.max(0, roundToHundredths(value)) };
};

export const reduceSessionSetActiveInspectorTabAction = (
	payload: unknown,
): Pick<SessionStateFields, "activeInspectorTab"> | null => {
	return payload === "edit" ||
		payload === "color" ||
		payload === "audio" ||
		payload === "export"
		? { activeInspectorTab: payload }
		: null;
};

export const reduceSessionSetTimelineZoomAction = (
	payload: unknown,
): Pick<SessionStateFields, "timelineZoom"> | null => {
	const value = finiteNumber(payload);
	return value === null ? null : { timelineZoom: clamp(value, 8, 96) };
};

export const reduceSessionZoomTimelineAction = (
	payload: unknown,
	state: Pick<SessionStateFields, "timelineZoom">,
): Pick<SessionStateFields, "timelineZoom"> | null => {
	const delta = finiteNumber(payload);
	return delta === null
		? null
		: { timelineZoom: clamp(state.timelineZoom + delta, 8, 96) };
};

export const sessionSelectEntityAction = {
	to: {
		selectedEntityId: ["selectedEntityId"],
	},
	fn: reduceSessionSelectEntityAction,
} as const satisfies DktActionDescriptor;

export const sessionCreateProjectAction = [
	{
		to: {
			selectedEntityId: ["selectedEntityId"],
			cursor: ["cursor"],
			createdProject: [
				"<< $root.project << #",
				{
					method: "at_end",
					can_create: true,
					can_hold_refs: true,
					creation_shape: PROJECT_CREATION_SHAPE,
				},
			],
			activeProject: [
				"<< activeProject",
				{
					method: "set_one",
					can_use_refs: true,
				},
			],
			lastActiveProject: [
				"<< $root.lastActiveProject",
				{ method: "set_one", can_use_refs: true },
			],
		},
		fn: [
			["< @all:title < pioneer.project", "$now"] as const,
			(payload: unknown, projectTitles: unknown, now: unknown) => {
				const seed = createProjectSeedPayload(
					payload,
					undefined,
					projectTitles,
					now,
				);

				return {
					selectedEntityId: null,
					cursor: 0,
					createdProject: {
						attrs: seed,
						hold_ref_id: "createdProject",
					},
					activeProject: { use_ref_id: "createdProject" },
					lastActiveProject: { use_ref_id: "createdProject" },
				};
			},
		],
	},
	{
		to: ["<< activeProject", { action: "handleInit", sub_flow: true }],
		fn: () => ({}),
	},
] as const satisfies DktActionDefinition;

export const sessionHandleInitAction = [
	{
		to: {
			pendingProjectInit: ["pendingProjectInit"],
			selectedEntityId: ["selectedEntityId"],
			cursor: ["cursor"],
			existingProject: [
				"<< activeProject",
				{
					method: "set_one",
					can_use_refs: true,
				},
			],
			createdProject: [
				"<< $root.project << #",
				{
					method: "at_end",
					can_create: true,
					can_hold_refs: true,
					creation_shape: PROJECT_CREATION_SHAPE,
				},
			],
			activeProject: [
				"<< activeProject",
				{
					method: "set_one",
					can_use_refs: true,
				},
			],
			lastActiveProject: [
				"<< $root.lastActiveProject",
				{ method: "set_one", can_use_refs: true },
			],
		},
		fn: [
			[
				"<< @one:activeProject",
				"storageOpenStatus",
				"<< @all:pioneer.project",
				"< @all:title < pioneer.project",
				"$now",
				"<< @one:pioneer.lastActiveProject",
			] as const,
			(
				payload: unknown,
				currentActiveProject: unknown,
				storageOpenStatus: unknown,
				projects: unknown,
				projectTitles: unknown,
				now: unknown,
				lastActiveProject: unknown,
			) => {
				if (currentActiveProject) {
					return { pendingProjectInit: null };
				}

				const existingProjects = Array.isArray(projects) ? projects : [];
				// A new session opens the project most recently made active by
				// any session, else the first one.
				const startProject = lastActiveProject || existingProjects.find(Boolean);
				if (startProject) {
					return {
						pendingProjectInit: null,
						selectedEntityId: null,
						cursor: 0,
						existingProject: startProject,
						lastActiveProject: startProject,
					};
				}

				if (storageOpenStatus !== WORKSPACE_OPEN_STATUS.LOCAL_EMPTY_READY) {
					return {
						pendingProjectInit: null,
						selectedEntityId: null,
						cursor: 0,
					};
				}

				const seed = createProjectSeedPayload(
					payload,
					undefined,
					projectTitles,
					now,
				);
				return {
					pendingProjectInit: seed,
					selectedEntityId: null,
					cursor: 0,
					createdProject: {
						attrs: seed,
						hold_ref_id: "createdProject",
					},
					activeProject: { use_ref_id: "createdProject" },
					lastActiveProject: { use_ref_id: "createdProject" },
				};
			},
		],
	},
	{
		to: ["<< activeProject", { action: "handleInit", sub_flow: true }],
		when_deps: ["pendingProjectInit"] as const,
		when_fn: (_payload: unknown, pendingProjectInit: unknown) =>
			Boolean(pendingProjectInit && typeof pendingProjectInit === "object"),
		fn: () => ({}),
	},
	{
		to: {
			pendingProjectInit: ["pendingProjectInit"],
		},
		fn: () => ({ pendingProjectInit: null }),
	},
] as const satisfies DktActionDefinition;

export const sessionSetActiveProjectAction = [
	{
		to: {
			selectedEntityId: ["selectedEntityId"],
			cursor: ["cursor"],
			activeProject: [
				"<< activeProject",
				{ method: "set_one", can_use_refs: true },
			],
			lastActiveProject: [
				"<< $root.lastActiveProject",
				{ method: "set_one", can_use_refs: true },
			],
		},
		fn: [
			["<< @all:pioneer.project"] as const,
			(payload: unknown, projects: unknown) => {
				const reset = reduceSessionSetActiveProjectAction(payload);
				const activeProjectId = payload;
				if (typeof activeProjectId !== "string" || !activeProjectId)
					return { ...reset, activeProject: null };
				const modelList = Array.isArray(projects) ? projects : [];
				const found = modelList.find(
					(item) =>
						asString((item as { _node_id?: unknown } | null)?._node_id) ===
						activeProjectId,
				);
				return found
					? { ...reset, activeProject: found, lastActiveProject: found }
					: { ...reset, activeProject: null };
			},
		],
	},
] as const satisfies DktActionDefinition;

export const sessionSyncActiveProjectRelAction = {
	to: {
		activeProject: ["<< activeProject", { method: "set_one" }],
	},
	fn: (payload: unknown) => ({
		activeProject: (payload as { project?: unknown } | null)?.project ?? null,
	}),
} as const satisfies DktActionDescriptor;

export const sessionSyncSelectedClipRelAction = {
	to: {
		selectedClip: ["<< selectedClip", { method: "set_one" }],
	},
	fn: (payload: unknown) => ({
		selectedClip: (payload as { clip?: unknown } | null)?.clip ?? null,
	}),
} as const satisfies DktActionDescriptor;

export const sessionSyncPreviewModelAction = {
	to: {
		previewStructure: ["previewStructure"],
	},
	fn: (payload: unknown) => ({
		previewStructure: (payload as { structure?: unknown } | null)
			?.structure ?? { clipSources: [] },
	}),
} as const satisfies DktActionDescriptor;

export const sessionSyncSelectedClipTrackPositionAction = {
	to: {
		selectedClipTrackPosition: ["selectedClipTrackPosition"],
	},
	fn: (payload: unknown) => ({
		selectedClipTrackPosition:
			(payload as { position?: unknown } | null)?.position ?? null,
	}),
} as const satisfies DktActionDescriptor;

export const sessionSyncSelectedClipSummaryAction = {
	to: {
		selectedClipSummary: ["selectedClipSummary"],
	},
	fn: (payload: unknown) => ({
		selectedClipSummary:
			(payload as { summary?: unknown } | null)?.summary ?? null,
	}),
} as const satisfies DktActionDescriptor;

export const sessionSetCursorAction = {
	to: {
		cursor: ["cursor"],
	},
	fn: [
		["$noop"] as const,
		(payload: unknown, noop: unknown) =>
			reduceSessionSetCursorAction(payload) ?? noop,
	],
} as const satisfies DktActionDescriptor;

const playbackRunPatch = ({
	cursor,
	now,
	rate,
	runId,
}: {
	cursor: number;
	now: number;
	rate: number;
	runId: number;
}) => ({
	cursor,
	playbackIntent: "playing" as const,
	playbackRunId: runId,
	playStartCursor: cursor,
	playStartedAt: now,
	playbackRate: rate,
});

export const sessionPlayAction = {
	to: {
		cursor: ["cursor"],
		playbackIntent: ["playbackIntent"],
		playbackRunId: ["playbackRunId"],
		playStartCursor: ["playStartCursor"],
		playStartedAt: ["playStartedAt"],
		playbackRate: ["playbackRate"],
	},
	fn: [
		[
			"$noop",
			"$now",
			"cursor",
			"playbackRunId",
			"playbackRate",
			"playbackBoundaryCursor",
		] as const,
		(
			_payload: unknown,
			noop: unknown,
			now: unknown,
			cursor: unknown,
			runId: unknown,
			rate: unknown,
			boundary: unknown,
		) => {
			const start = Math.max(0, asNumber(cursor, 0));
			const end = Math.max(0, asNumber(boundary, 0));
			if (end <= start) return noop;
			return playbackRunPatch({
				cursor: start,
				now: asNumber(now, 0),
				rate: Math.max(0.01, asNumber(rate, 1)),
				runId: Math.max(0, asNumber(runId, 0)) + 1,
			});
		},
	],
} as const satisfies DktActionDescriptor;

type PausePlaybackDeps = {
	intent: unknown;
	runId: unknown;
	startCursor: unknown;
	startedAt: unknown;
	rate: unknown;
	boundary: unknown;
	now: unknown;
};

/**
 * Pause position. UI pauses send `payload.cursor` from the presentation clock
 * (PlaybackRuntime snapshot `presentationTime`, timeline time); that is the
 * source of truth and is only clamped to `[0, playbackBoundaryCursor]`. Later
 * the audio clock drives the same snapshot through the runtime clock
 * interface; the action and protocol stay unchanged. Without a cursor
 * (non-UI pauses) the model derives the position at this event from the run
 * it started: `playStartCursor + (now - playStartedAt) / 1000 * playbackRate`.
 * The cursor is never ticked during playback.
 */
export const reducePausePlayback = (
	payload: unknown,
	noop: unknown,
	deps: PausePlaybackDeps,
) => {
	const value = asObject(payload);
	const requestedRunId = finiteNumber(value?.runId);
	if (requestedRunId !== null && requestedRunId !== asNumber(deps.runId, 0)) {
		return noop;
	}
	const end = Math.max(0, asNumber(deps.boundary, 0));
	const override = finiteNumber(value?.cursor);
	if (override !== null) {
		return { cursor: clamp(override, 0, end), playbackIntent: "paused" as const };
	}
	if (deps.intent !== "playing") return noop;
	const rate = Math.max(0.01, asNumber(deps.rate, 1));
	const elapsedSeconds = Math.max(0, asNumber(deps.now, 0) - asNumber(deps.startedAt, 0)) / 1000;
	return {
		cursor: clamp(asNumber(deps.startCursor, 0) + elapsedSeconds * rate, 0, end),
		playbackIntent: "paused" as const,
	};
};

export const sessionPausePlaybackAction = {
	to: {
		cursor: ["cursor"],
		playbackIntent: ["playbackIntent"],
	},
	fn: [
		[
			"$noop",
			"$now",
			"playbackIntent",
			"playbackRunId",
			"playStartCursor",
			"playStartedAt",
			"playbackRate",
			"playbackBoundaryCursor",
		] as const,
		(
			payload: unknown,
			noop: unknown,
			now: unknown,
			intent: unknown,
			runId: unknown,
			startCursor: unknown,
			startedAt: unknown,
			rate: unknown,
			boundary: unknown,
		) =>
			reducePausePlayback(payload, noop, {
				now,
				intent,
				runId,
				startCursor,
				startedAt,
				rate,
				boundary,
			}),
	],
} as const satisfies DktActionDescriptor;

export const sessionCommitSeekAction = {
	to: {
		cursor: ["cursor"],
		playbackIntent: ["playbackIntent"],
		playbackRunId: ["playbackRunId"],
		playStartCursor: ["playStartCursor"],
		playStartedAt: ["playStartedAt"],
		playbackRate: ["playbackRate"],
	},
	fn: [
		[
			"$noop",
			"$now",
			"isPlaying",
			"playbackRunId",
			"playbackRate",
			"playbackBoundaryCursor",
		] as const,
		(
			payload: unknown,
			noop: unknown,
			now: unknown,
			isPlaying: unknown,
			runId: unknown,
			rate: unknown,
			boundary: unknown,
		) => {
			const requested = finiteNumber(
				asObject(payload)?.cursor ?? payload,
			);
			if (requested === null) return noop;
			const end = Math.max(0, asNumber(boundary, 0));
			const cursor = clamp(requested, 0, end);
			if (!isPlaying || cursor >= end) {
				return { cursor, playbackIntent: "paused" as const };
			}
			return playbackRunPatch({
				cursor,
				now: asNumber(now, 0),
				rate: Math.max(0.01, asNumber(rate, 1)),
				runId: Math.max(0, asNumber(runId, 0)) + 1,
			});
		},
	],
} as const satisfies DktActionDescriptor;

export const sessionSetPlaybackRateAction = {
	to: {
		cursor: ["cursor"],
		playbackIntent: ["playbackIntent"],
		playbackRunId: ["playbackRunId"],
		playStartCursor: ["playStartCursor"],
		playStartedAt: ["playStartedAt"],
		playbackRate: ["playbackRate"],
	},
	fn: [
		[
			"$noop",
			"$now",
			"isPlaying",
			"cursor",
			"playbackRunId",
			"playbackBoundaryCursor",
		] as const,
		(
			payload: unknown,
			noop: unknown,
			now: unknown,
			isPlaying: unknown,
			cursor: unknown,
			runId: unknown,
			boundary: unknown,
		) => {
			const value = finiteNumber(asObject(payload)?.rate ?? payload);
			if (value === null || value <= 0) return noop;
			const rate = clamp(value, 0.1, 16);
			if (!isPlaying) return { playbackRate: rate };
			return playbackRunPatch({
				cursor: Math.max(0, asNumber(asObject(payload)?.cursor, asNumber(cursor, 0))),
				now: asNumber(now, 0),
				rate,
				runId: Math.max(0, asNumber(runId, 0)) + 1,
			});
		},
	],
} as const satisfies DktActionDescriptor;

export const sessionCompletePlaybackAction = {
	to: {
		cursor: ["cursor"],
		playbackIntent: ["playbackIntent"],
	},
	fn: [
		["$noop", "playbackRunId", "playbackBoundaryCursor"] as const,
		(payload: unknown, noop: unknown, currentRunId: unknown, boundary: unknown) => {
			const value = asObject(payload);
			const runId = finiteNumber(value?.runId);
			if (runId === null || runId !== asNumber(currentRunId, 0)) return noop;
			return {
				cursor: clamp(
					asNumber(value?.cursor, asNumber(boundary, 0)),
					0,
					Math.max(0, asNumber(boundary, 0)),
				),
				playbackIntent: "paused" as const,
			};
		},
	],
} as const satisfies DktActionDescriptor;

export const sessionHandleIsPlayingAction = {
	to: [
		"$fx_applyPlaybackRun",
		{ intent: "call", drop_when_api_not_ready: false },
	],
	fn: [
		[
			"playbackRunId",
			"playStartCursor",
			"playStartedAt",
			"playbackRate",
			"playbackBoundaryCursor",
			"cursor",
			"_node_id",
		] as const,
		(
			payload: unknown,
			runId: unknown,
			startCursor: unknown,
			startedAt: unknown,
			rate: unknown,
			boundaryCursor: unknown,
			cursor: unknown,
			sessionRootNodeId: unknown,
		) => {
			const isPlaying =
				(payload as { next_value?: unknown } | null)?.next_value === true;
			// The effect interface is shared by all windows; the session root id
			// tells the host which window playback this run belongs to.
			const owner = { sessionRootNodeId: asString(sessionRootNodeId) };
			return isPlaying
				? {
						...owner,
						run: {
							runId: asNumber(runId, 0),
							startCursorSeconds: asNumber(startCursor, 0),
							startedAtEpochMs: asNumber(startedAt, 0),
							playbackRate: asNumber(rate, 1),
							boundaryCursorSeconds: asNumber(boundaryCursor, 0),
						},
					}
				: { ...owner, run: null, committedCursor: asNumber(cursor, 0) };
		},
	],
} as const satisfies DktActionDescriptor;

export const sessionHandlePlaybackBoundaryAction = {
	to: [
		"$fx_applyPlaybackRun",
		{ intent: "call", drop_when_api_not_ready: false },
	],
	fn: [
		[
			"$noop",
			"isPlaying",
			"playbackRunId",
			"playStartCursor",
			"playStartedAt",
			"playbackRate",
			"playbackBoundaryCursor",
			"_node_id",
		] as const,
		(
			_payload: unknown,
			noop: unknown,
			isPlaying: unknown,
			runId: unknown,
			startCursor: unknown,
			startedAt: unknown,
			rate: unknown,
			boundaryCursor: unknown,
			sessionRootNodeId: unknown,
		) =>
			isPlaying === true
				? {
						sessionRootNodeId: asString(sessionRootNodeId),
						run: {
							runId: asNumber(runId, 0),
							startCursorSeconds: asNumber(startCursor, 0),
							startedAtEpochMs: asNumber(startedAt, 0),
							playbackRate: asNumber(rate, 1),
							boundaryCursorSeconds: asNumber(boundaryCursor, 0),
						},
					}
				: noop,
	],
} as const satisfies DktActionDescriptor;

export const sessionSetActiveInspectorTabAction = {
	to: {
		activeInspectorTab: ["activeInspectorTab"],
	},
	fn: (payload: unknown) =>
		reduceSessionSetActiveInspectorTabAction(payload) ?? {},
} as const satisfies DktActionDescriptor;

export const sessionSetTimelineZoomAction = {
	to: {
		timelineZoom: ["timelineZoom"],
	},
	fn: [
		["$noop"] as const,
		(payload: unknown, noop: unknown) =>
			reduceSessionSetTimelineZoomAction(payload) ?? noop,
	],
} as const satisfies DktActionDescriptor;

export const sessionZoomTimelineAction = {
	to: {
		timelineZoom: ["timelineZoom"],
	},
	fn: [
		["$noop", "timelineZoom"] as const,
		(payload: unknown, noop: unknown, timelineZoom: unknown) => {
			const current = typeof timelineZoom === "number" ? timelineZoom : 16;
			return reduceSessionZoomTimelineAction(payload, { timelineZoom: current }) ?? noop;
		},
	],
} as const satisfies DktActionDescriptor;

export const sessionSetExportProgressAction = {
	to: {
		exportProgress: ["exportProgress"],
	},
	fn: [
		["$now", "$noop", "exportProgress", "exportRequest"] as const,
		(
			payload: unknown,
			now: unknown,
			noop: unknown,
			exportProgress: unknown,
			exportRequest: unknown,
		) =>
			reduceSessionSetExportProgressAction(
				payload,
				now,
				noop,
				exportProgress,
				exportRequest,
			),
	],
} as const satisfies DktActionDescriptor;

export const sessionCancelExportAction = [
	{
		to: {
			exportRequest: ["exportRequest"],
			exportProgress: ["exportProgress"],
			cancelFxPayload: ["$output"],
		},
		fn: [
			["$noop", "exportProgress", "exportRequest", "$now"] as const,
			(
				payload: unknown,
				noop: unknown,
				exportProgress: unknown,
				exportRequest: unknown,
				now: unknown,
			) => {
				const progress = asObject(exportProgress);
				const requestedId =
					asString((payload as { id?: unknown } | null)?.id) ?? asString(payload);
				const currentId = asString(progress?.id) ?? asString(asObject(exportRequest)?.id);
				// Stale or unknown id: the export it names is not the current one.
				if (!requestedId || requestedId !== currentId) {
					return noop;
				}
				if (progress && !isExportRunning(progress as unknown as ExportProgressState)) {
					return noop;
				}
				const range =
					normalizeExportRange(progress?.range) ??
					normalizeExportRange(asObject(exportRequest)?.range);
				if (!range) {
					return noop;
				}
				const initiatedBy =
					asString(progress?.initiatedBy) ?? asString(asObject(exportRequest)?.initiatedBy);
				return {
					exportRequest: null,
					exportProgress: {
						id: requestedId,
						range,
						stage: "cancelled",
						progress: clampProgressPercent(progress?.progress, 0),
						updatedAt: asNumber(now, 0),
						initiatedBy,
					} satisfies ExportProgressState,
					cancelFxPayload: {
						id: requestedId,
						queueKey: range.type === "clip" ? `clip:${range.clipId}` : "project",
						initiatedBy,
					},
				};
			},
		],
	},
	{
		to: [
			"$fx_cancelExport",
			{ intent: "call", drop_when_api_not_ready: false },
		],
		fn: [
			["$noop"] as const,
			(payload: unknown, noop: unknown) =>
				payload && typeof payload === "object" ? payload : noop,
		],
	},
] as const satisfies DktActionDefinition;

export const sessionClearExportProgressAction = {
	to: {
		exportProgress: ["exportProgress"],
	},
	fn: () => ({ exportProgress: null }),
} as const satisfies DktActionDescriptor;

export const sessionRequestImportFilesAction = {
	aggregate: {
		name: "importPipeline",
		role: "boundary",
		as: "requestImportFiles",
		permission: "entry",
	},
	steps: [
		{
			to: {
				projectImport: [
					"<< activeProject",
					{ action: "requestImportFiles", sub_flow: true },
				],
				importFxPayload: ["$output"],
			},
			fn: (payload: unknown) => ({
				projectImport: payload as Record<string, unknown>,
				importFxPayload: payload,
			}),
		},
		{
			to: [
				"$fx_handleInputFiles",
				{ intent: "call", drop_when_api_not_ready: false },
			],
			fn: [
				["$noop", "< @one:_node_id < activeProject"] as const,
				(payload: unknown, noop: unknown, projectNodeId: unknown) => {
					const inputBatchHandleId = asString(
						(payload as { inputBatchHandleId?: unknown } | null)
							?.inputBatchHandleId,
					);
					const projectId = asString(projectNodeId);
					if (!inputBatchHandleId || !projectId) {
						return noop;
					}
					return {
						projectId,
						inputBatchHandleId,
						addToTimelineWhenEmpty: true,
					} as ImportFilesFxPayload;
				},
			],
		},
	],
} as const satisfies DktActionDefinition;

export const sessionSetActiveProjectImportProgressAction = {
	aggregate: {
		name: "importPipeline",
		role: "boundary",
		as: "setActiveProjectImportProgress",
		permission: "entry",
	},
	steps: [
		{
			to: ["<< activeProject", { action: "setImportProgress", sub_flow: true }],
			fn: (payload: unknown) => payload as Record<string, unknown>,
		},
	],
} as const satisfies DktActionDefinition;

export const sessionImportResourceIntoActiveProjectAction = [
	{
		to: [
			"<< activeProject",
			{ action: "importResource", sub_flow: true },
		],
		fn: (payload: unknown) => payload as Record<string, unknown>,
	},
] as const satisfies DktActionDefinition;

export const sessionAddActiveProjectResourceToTimelineAction = [
	{
		to: [
			"<< activeProject",
			{ action: "addResourceToTimeline", sub_flow: true },
		],
		fn: (payload: unknown) => payload as Record<string, unknown>,
	},
] as const satisfies DktActionDefinition;

export const sessionAddActiveProjectEmbeddedAudioToTimelineAction = [
	{
		to: [
			"<< activeProject",
			{ action: "addEmbeddedAudioToTimeline", sub_flow: true },
		],
		fn: (payload: unknown) => payload as Record<string, unknown>,
	},
] as const satisfies DktActionDefinition;

export const sessionRequestProjectExportAction = [
	{
		to: {
			exportRequest: ["exportRequest"],
			exportProgress: ["exportProgress"],
			exportFxPayload: ["$output"],
		},
		fn: [
			[
				"$noop",
				"< @one:_node_id < activeProject",
				"< @one:fps < activeProject",
				"< @one:width < activeProject",
				"< @one:height < activeProject",
				"< @one:duration < activeProject",
				"< @all:clipRenderData < activeProject.tracks.clips",
				"_node_id",
				"$now",
			] as const,
			(
				payload: unknown,
				noop: unknown,
				projectId: unknown,
				fps: unknown,
				width: unknown,
				height: unknown,
				duration: unknown,
				clipSources: unknown,
				sessionRootNodeId: unknown,
				now: unknown,
			) => {
				const plan = buildExportPlan(
					projectId,
					fps,
					width,
					height,
					duration,
					clipSources,
				);
				if (!plan) {
					return noop;
				}
				const value = asObject(payload);
				const initiatedBy =
					asString(value?.initiatedBy) ?? asString(sessionRootNodeId);
				const id = asString(value?.id);
				if (!id) {
					return noop;
				}
				const range: ExportProgressState["range"] = { type: "project" };
				const request = {
					id,
					range,
					format: "video-webm" as const,
					plan,
					requestedAt: asNumber(now, 0),
					initiatedBy,
				};
				return {
					exportRequest: request,
					exportProgress: createQueuedProgressState(
						id,
						range,
						initiatedBy,
						asNumber(now, 0),
					),
					exportFxPayload: {
						request,
						queueKey: "project",
					} as ExportFxPayload,
				};
			},
		],
	},
	{
		to: [
			"$fx_renderExport",
			{ intent: "call", drop_when_api_not_ready: false },
		],
		fn: [
			["$noop"] as const,
			(payload: unknown, noop: unknown) => {
			if (!payload || typeof payload !== "object") {
				return noop;
			}
			return payload;
			},
		],
	},
] as const satisfies DktActionDefinition;

export const sessionRequestClipExportAction = [
	{
		to: {
			exportRequest: ["exportRequest"],
			exportProgress: ["exportProgress"],
			exportFxPayload: ["$output"],
		},
		fn: [
			[
				"$noop",
				"< @one:_node_id < activeProject",
				"< @one:fps < activeProject",
				"< @one:width < activeProject",
				"< @one:height < activeProject",
				"< @one:duration < activeProject",
				"< @all:clipRenderData < activeProject.tracks.clips",
				"< @all:_node_id < activeProject.tracks.clips",
				"_node_id",
				"$now",
			] as const,
			(
				payload: unknown,
				noop: unknown,
				projectId: unknown,
				fps: unknown,
				width: unknown,
				height: unknown,
				duration: unknown,
				clipSources: unknown,
				clipIds: unknown,
				sessionRootNodeId: unknown,
				now: unknown,
			) => {
				const plan = buildExportPlan(
					projectId,
					fps,
					width,
					height,
					duration,
					clipSources,
				);
				if (!plan) {
					return noop;
				}

				const value = asObject(payload);
				const clipId = asString(value?.clipId);
				if (!clipId) {
					return noop;
				}
				const normalizedClipIds = Array.isArray(clipIds)
					? clipIds.filter(
							(entry): entry is string => typeof entry === "string",
						)
					: [];
				if (!normalizedClipIds.includes(clipId)) {
					return noop;
				}

				const initiatedBy =
					asString(value?.initiatedBy) ?? asString(sessionRootNodeId);
				const id = asString(value?.id);
				if (!id) {
					return noop;
				}
				const range: ExportProgressState["range"] = { type: "clip", clipId };
				const request = {
					id,
					range,
					format: "video-webm" as const,
					plan,
					requestedAt: asNumber(now, 0),
					initiatedBy,
				};
				return {
					exportRequest: request,
					exportProgress: createQueuedProgressState(
						id,
						range,
						initiatedBy,
						asNumber(now, 0),
					),
					exportFxPayload: {
						request,
						queueKey: `clip:${clipId}`,
					} as ExportFxPayload,
				};
			},
		],
	},
	{
		to: [
			"$fx_renderExport",
			{ intent: "call", drop_when_api_not_ready: false },
		],
		fn: [
			["$noop"] as const,
			(payload: unknown, noop: unknown) => {
			if (!payload || typeof payload !== "object") {
				return noop;
			}
			return payload;
			},
		],
	},
] as const satisfies DktActionDefinition;

export const sessionRequestSelectedClipExportAction = [
	{
		to: {
			exportRequest: ["exportRequest"],
			exportProgress: ["exportProgress"],
			exportFxPayload: ["$output"],
		},
		fn: [
			[
				"$noop",
				"< @one:_node_id < activeProject",
				"< @one:fps < activeProject",
				"< @one:width < activeProject",
				"< @one:height < activeProject",
				"< @one:duration < activeProject",
				"< @all:clipRenderData < activeProject.tracks.clips",
				"< @one:_node_id < selectedClip",
				"_node_id",
				"$now",
			] as const,
			(
				payload: unknown,
				noop: unknown,
				projectId: unknown,
				fps: unknown,
				width: unknown,
				height: unknown,
				duration: unknown,
				clipSources: unknown,
				selectedClipId: unknown,
				sessionRootNodeId: unknown,
				now: unknown,
			) => {
				const plan = buildExportPlan(
					projectId,
					fps,
					width,
					height,
					duration,
					clipSources,
				);
				const clipId = asString(selectedClipId);
				if (!plan || !clipId) {
					return noop;
				}
				const value = asObject(payload);
				const initiatedBy =
					asString(value?.initiatedBy) ?? asString(sessionRootNodeId);
				const id = asString(value?.id);
				if (!id) {
					return noop;
				}
				const range: ExportProgressState["range"] = { type: "clip", clipId };
				const request = {
					id,
					range,
					format: "video-webm" as const,
					plan,
					requestedAt: asNumber(now, 0),
					initiatedBy,
				};
				return {
					exportRequest: request,
					exportProgress: createQueuedProgressState(
						id,
						range,
						initiatedBy,
						asNumber(now, 0),
					),
					exportFxPayload: {
						request,
						queueKey: `clip:${clipId}`,
					} as ExportFxPayload,
				};
			},
		],
	},
	{
		to: [
			"$fx_renderExport",
			{ intent: "call", drop_when_api_not_ready: false },
		],
		fn: [
			["$noop"] as const,
			(payload: unknown, noop: unknown) => {
			if (!payload || typeof payload !== "object") {
				return noop;
			}
			return payload;
			},
		],
	},
] as const satisfies DktActionDefinition;

export const sessionConsumeExportRequestAction = {
	to: {
		exportRequest: ["exportRequest"],
	},
	fn: [
		["$noop", "exportRequest"] as const,
		(payload: unknown, noop: unknown, exportRequest: unknown) => {
			const current = asObject(exportRequest);
			if (!current) {
				return noop;
			}
			const payloadId =
				asString((payload as { id?: unknown } | null)?.id) ?? asString(payload);
			if (payloadId && payloadId !== asString(current.id)) {
				return noop;
			}
			return { exportRequest: null };
		},
	],
} as const satisfies DktActionDescriptor;

export const sessionDeleteSelectedClipAction = [
	{
		to: ["<< selectedClip", { action: "removeSelf", sub_flow: true }],
		fn: () => ({}),
	},
	{
		to: {
			selectedEntityId: ["selectedEntityId"],
		},
		fn: () => ({
			selectedEntityId: null,
		}),
	},
] as const satisfies DktActionDefinition;

export const sessionNudgeSelectedClipAction = [
	{
		to: ["<< selectedClip", { action: "moveBy", sub_flow: true }],
		fn: (payload: unknown) => {
			const delta =
				typeof payload === "number"
					? payload
					: (payload as { delta?: unknown } | null)?.delta;
			return typeof delta === "number" && Number.isFinite(delta) && delta !== 0
				? { delta }
				: {};
		},
	},
] as const satisfies DktActionDefinition;

export const sessionSplitSelectedClipAction = [
	{
		to: ["<< selectedClip", { action: "splitSelfAt", sub_flow: true }],
		fn: [
			["cursor"] as const,
			(_payload: unknown, cursor: unknown) => {
				const time =
					typeof cursor === "number" && Number.isFinite(cursor)
						? roundToHundredths(cursor)
						: null;
				if (time === null) return {};
				return { time };
			},
		],
	},
] as const satisfies DktActionDefinition;

export const dktSessionActions = {
	handleInit: sessionHandleInitAction,
	createProject: sessionCreateProjectAction,
	selectEntity: sessionSelectEntityAction,
	addTextClipToTimeline: [
		{
			to: [
				"<< activeProject",
				{ action: "addTextClipToVideoTrack", sub_flow: true },
			],
			fn: (payload: unknown) => payload as Record<string, unknown>,
		},
		{
			to: {
				selectedEntityId: ["selectedEntityId"],
			},
			fn: (payload: unknown) => ({
				selectedEntityId: asString(
					(payload as { clipId?: unknown } | null)?.clipId,
				),
			}),
		},
	],
	setActiveProject: sessionSetActiveProjectAction,
	syncActiveProjectRel: sessionSyncActiveProjectRelAction,
	syncSelectedClipRel: sessionSyncSelectedClipRelAction,
	syncPreviewModel: sessionSyncPreviewModelAction,
	syncSelectedClipTrackPosition: sessionSyncSelectedClipTrackPositionAction,
	syncSelectedClipSummary: sessionSyncSelectedClipSummaryAction,
	setActiveInspectorTab: sessionSetActiveInspectorTabAction,
	setCursor: sessionSetCursorAction,
	play: sessionPlayAction,
	pausePlayback: sessionPausePlaybackAction,
	commitSeek: sessionCommitSeekAction,
	setPlaybackRate: sessionSetPlaybackRateAction,
	completePlayback: sessionCompletePlaybackAction,
	"handleAttr:isPlaying": sessionHandleIsPlayingAction,
	"handleAttr:playbackBoundaryCursor": sessionHandlePlaybackBoundaryAction,
	setTimelineZoom: sessionSetTimelineZoomAction,
	zoomTimeline: sessionZoomTimelineAction,
	nudgeSelectedClip: sessionNudgeSelectedClipAction,
	requestImportFiles: sessionRequestImportFilesAction,
	setActiveProjectImportProgress: sessionSetActiveProjectImportProgressAction,
	importResourceIntoActiveProject: sessionImportResourceIntoActiveProjectAction,
	addActiveProjectResourceToTimeline:
		sessionAddActiveProjectResourceToTimelineAction,
	addActiveProjectEmbeddedAudioToTimeline:
		sessionAddActiveProjectEmbeddedAudioToTimelineAction,
	deleteSelectedClip: sessionDeleteSelectedClipAction,
	splitSelectedClip: sessionSplitSelectedClipAction,
	startPreviewBuffer: {
		to: {
			previewBuffer: ["previewBuffer"],
		},
		fn: [
			["previewStructure", "cursor"] as const,
			(_payload: unknown, previewStructure: unknown, cursor: unknown) => {
				const structure: PreviewStructure =
					previewStructure &&
					typeof previewStructure === "object" &&
					Array.isArray(
						(previewStructure as { clipSources?: unknown }).clipSources,
					)
						? (previewStructure as PreviewStructure)
						: { clipSources: [] };
				const startCursor =
					typeof cursor === "number" && Number.isFinite(cursor) ? cursor : 0;
				return { previewBuffer: buildPreviewBuffer(structure, startCursor) };
			},
		],
	} as const satisfies DktActionDescriptor,
	clearPreviewBuffer: {
		to: {
			previewBuffer: ["previewBuffer"],
		},
		fn: () => ({ previewBuffer: null }),
	} as const satisfies DktActionDescriptor,
	requestProjectExport: sessionRequestProjectExportAction,
	requestClipExport: sessionRequestClipExportAction,
	requestSelectedClipExport: sessionRequestSelectedClipExportAction,
	consumeExportRequest: sessionConsumeExportRequestAction,
	cancelExport: sessionCancelExportAction,
	setExportProgress: sessionSetExportProgressAction,
	clearExportProgress: sessionClearExportProgressAction,
} as const satisfies Record<DktSessionActionName, DktActionDefinition>;
