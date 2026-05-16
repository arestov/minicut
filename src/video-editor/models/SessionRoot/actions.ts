import type { ExportProgressState } from "../../app/exportProgressState";
import { clampProgressPercent } from "../../app/exportProgressState";
import type { ExportRequestState } from "../../app/exportRequestState";
import {
	buildPreviewBuffer,
	PREVIEW_BUFFER_REFILL_THRESHOLD_SECONDS,
	type PreviewBuffer,
	type PreviewClipSource,
	type PreviewStructure,
} from "../../read-model/previewComps";
import { type ExportPlan, normalizeExportPlan } from "../../render/renderPlan";
import { PROJECT_CREATION_SHAPE } from "../Project";
import { normalizeResourceCreationAttrs } from "../Project/actions";
import { RESOURCE_CREATION_SHAPE } from "../Resource";

/** Inline session state patch type – replaces legacy EditorSessionState from domain/types. */
type SessionStateFields = {
	activeProjectId: string | null;
	pendingProjectInit: Record<string, unknown> | null;
	selectedEntityId: string | null;
	cursor: number;
	isPlaying: boolean;
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
	| "setPlaying"
	| "setTimelineZoom"
	| "tickPlayback"
	| "addTextClipToTimeline"
	| "requestImportFiles"
	| "setActiveProjectImportProgress"
	| "importResourceIntoActiveProject"
	| "addActiveProjectResourceToTimeline"
	| "addActiveProjectEmbeddedAudioToTimeline"
	| "syncSelectedClipRel"
	| "togglePlayback"
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
	| "setExportProgress"
	| "clearExportProgress";

export type DktSessionActionPatch = Partial<
	Pick<
		SessionStateFields,
		| "activeProjectId"
		| "selectedEntityId"
		| "cursor"
		| "isPlaying"
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
		| ((payload: unknown) => DktSessionActionPatch | null)
		| readonly [
				readonly string[],
				(
					payload: unknown,
					...deps: unknown[]
				) => DktSessionActionPatch | Record<string, unknown> | null,
		  ]
		| ((payload: unknown) => Record<string, unknown> | null);
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
		value === "error"
	) {
		return value;
	}
	return null;
};

const reduceSessionSetExportProgressAction = (
	payload: unknown,
): Pick<SessionStateFields, "exportProgress"> => {
	if (payload === null) {
		return { exportProgress: null };
	}

	const value = asObject(payload);
	const range = normalizeExportRange(value?.range);
	const stage = normalizeExportStage(value?.stage);
	if (!value || !range || !stage) {
		return { exportProgress: null };
	}

	const progressFallback = stage === "done" ? 100 : 0;
	return {
		exportProgress: {
			id: asString(value.id) ?? `export:${Date.now().toString(36)}`,
			range,
			stage,
			progress: clampProgressPercent(value.progress, progressFallback),
			updatedAt: asNumber(value.updatedAt, Date.now()),
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

const createExportRequestId = (): string =>
	`export:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;

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
): ExportProgressState => ({
	id,
	range,
	stage: "queued",
	progress: 0,
	updatedAt: Date.now(),
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

let createdProjectSequence = 0;

const getNextProjectIndex = (projectTitles: unknown): number => {
	const titleList = Array.isArray(projectTitles) ? projectTitles : [];
	let maxIndex = createdProjectSequence;
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
) => {
	const value = asObject(payload) as CreateProjectPayload | null;
	const nextSequence = forcedProjectId
		? createdProjectSequence || 1
		: getNextProjectIndex(projectTitles);
	if (!forcedProjectId) {
		createdProjectSequence = nextSequence;
	}
	const now = Date.now();
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
	payload: unknown,
): Pick<
	SessionStateFields,
	"activeProjectId" | "selectedEntityId" | "cursor"
> => ({
	activeProjectId: typeof payload === "string" ? payload : null,
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

export const reduceSessionSetPlayingAction = (
	payload: unknown,
): Pick<SessionStateFields, "isPlaying"> | null => {
	return typeof payload === "boolean" ? { isPlaying: payload } : null;
};

export const reduceSessionSetTimelineZoomAction = (
	payload: unknown,
): Pick<SessionStateFields, "timelineZoom"> | null => {
	const value = finiteNumber(payload);
	return value === null ? null : { timelineZoom: clamp(value, 8, 96) };
};

export const reduceSessionTogglePlaybackAction = (
	state: Pick<SessionStateFields, "isPlaying">,
): Pick<SessionStateFields, "isPlaying"> => ({
	isPlaying: !state.isPlaying,
});

export const reduceSessionTickPlaybackAction = (
	payload: unknown,
	state: Pick<SessionStateFields, "cursor" | "isPlaying"> &
		Partial<
			Pick<SessionStateFields, "previewBuffer"> & {
				previewStructure: PreviewStructure;
			}
		>,
): Pick<SessionStateFields, "cursor" | "previewBuffer"> | null => {
	if (!state.isPlaying) {
		return null;
	}

	const deltaSeconds = finiteNumber(
		(payload as { deltaSeconds?: unknown } | null)?.deltaSeconds,
	);
	if (deltaSeconds === null) {
		return null;
	}

	const cursor = Math.max(0, roundToHundredths(state.cursor + deltaSeconds));
	if (
		!state.previewBuffer ||
		cursor + PREVIEW_BUFFER_REFILL_THRESHOLD_SECONDS >=
			state.previewBuffer.endCursor
	) {
		const previewStructure =
			state.previewStructure &&
			Array.isArray(state.previewStructure.clipSources)
				? state.previewStructure
				: { clipSources: [] };
		return {
			cursor,
			previewBuffer: buildPreviewBuffer(previewStructure, cursor),
		};
	}

	return { cursor };
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
			activeProjectId: ["activeProjectId"],
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
		},
		fn: [
			["< @all:title < pioneer.project"] as const,
			(payload: unknown, projectTitles: unknown) => {
				const seed = createProjectSeedPayload(
					payload,
					undefined,
					projectTitles,
				);

				return {
					activeProjectId: null,
					selectedEntityId: null,
					cursor: 0,
					createdProject: {
						attrs: seed,
						hold_ref_id: "createdProject",
					},
					activeProject: { use_ref_id: "createdProject" },
				};
			},
		],
	},
	{
		to: {
			activeProjectId: ["activeProjectId"],
		},
		fn: [
			["< @one:_node_id < activeProject"] as const,
			(_payload: unknown, projectNodeId: unknown) => ({
				activeProjectId:
					typeof projectNodeId === "string" ? projectNodeId : null,
			}),
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
			activeProjectId: ["activeProjectId"],
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
		},
		fn: [
			[
				"activeProjectId",
				"<< @all:pioneer.project",
				"< @all:title < pioneer.project",
			] as const,
			(
				payload: unknown,
				activeProjectId: unknown,
				projects: unknown,
				projectTitles: unknown,
			) => {
				if (typeof activeProjectId === "string" && activeProjectId) {
					const existingProjects = Array.isArray(projects) ? projects : [];
					const activeProject = existingProjects.find(
						(item) =>
							asString((item as { _node_id?: unknown } | null)?._node_id) ===
							activeProjectId,
					);
					return activeProject
						? { pendingProjectInit: null, existingProject: activeProject }
						: { pendingProjectInit: null };
				}

				const existingProjects = Array.isArray(projects) ? projects : [];
				const firstProject = existingProjects.find(Boolean);
				if (firstProject) {
					return {
						activeProjectId: null,
						pendingProjectInit: null,
						selectedEntityId: null,
						cursor: 0,
						existingProject: firstProject,
					};
				}

				const seed = createProjectSeedPayload(
					payload,
					undefined,
					projectTitles,
				);
				return {
					activeProjectId: null,
					pendingProjectInit: seed,
					selectedEntityId: null,
					cursor: 0,
					createdProject: {
						attrs: seed,
						hold_ref_id: "createdProject",
					},
					activeProject: { use_ref_id: "createdProject" },
				};
			},
		],
	},
	{
		to: {
			activeProjectId: ["activeProjectId"],
		},
		when_deps: ["pendingProjectInit"] as const,
		when_fn: (_payload: unknown, pendingProjectInit: unknown) =>
			pendingProjectInit === null,
		fn: [
			["< @one:_node_id < activeProject"] as const,
			(_payload: unknown, projectNodeId: unknown) => ({
				activeProjectId:
					typeof projectNodeId === "string" ? projectNodeId : null,
			}),
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
			activeProjectId: ["activeProjectId"],
		},
		when_deps: ["pendingProjectInit"] as const,
		when_fn: (_payload: unknown, pendingProjectInit: unknown) =>
			Boolean(pendingProjectInit && typeof pendingProjectInit === "object"),
		fn: [
			["< @one:_node_id < activeProject"] as const,
			(_payload: unknown, projectNodeId: unknown) => ({
				activeProjectId:
					typeof projectNodeId === "string" ? projectNodeId : null,
			}),
		],
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
			activeProjectId: ["activeProjectId"],
			selectedEntityId: ["selectedEntityId"],
			cursor: ["cursor"],
		},
		fn: reduceSessionSetActiveProjectAction,
	},
	{
		to: {
			activeProject: ["<< activeProject", { method: "set_one" }],
		},
		fn: [
			["<< @all:pioneer.project", "activeProjectId"] as const,
			(_payload: unknown, projects: unknown, activeProjectId: unknown) => {
				if (typeof activeProjectId !== "string" || !activeProjectId)
					return { activeProject: null };
				const modelList = Array.isArray(projects) ? projects : [];
				const found = modelList.find(
					(item) =>
						asString((item as { _node_id?: unknown } | null)?._node_id) ===
						activeProjectId,
				);
				return { activeProject: found ?? null };
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

export const sessionSetActiveInspectorTabAction = {
	to: {
		activeInspectorTab: ["activeInspectorTab"],
	},
	fn: (payload: unknown) =>
		reduceSessionSetActiveInspectorTabAction(payload) ?? {},
} as const satisfies DktActionDescriptor;

export const sessionSetPlayingAction = {
	to: {
		isPlaying: ["isPlaying"],
	},
	fn: [
		["$noop"] as const,
		(payload: unknown, noop: unknown) =>
			reduceSessionSetPlayingAction(payload) ?? noop,
	],
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

export const sessionTogglePlaybackAction = {
	to: {
		isPlaying: ["isPlaying"],
	},
	fn: [
		["isPlaying"] as const,
		(_payload: unknown, isPlaying: unknown) =>
			reduceSessionTogglePlaybackAction({ isPlaying: Boolean(isPlaying) }),
	],
} as const satisfies DktActionDescriptor;

export const sessionTickPlaybackAction = {
	to: {
		cursor: ["cursor"],
		previewBuffer: ["previewBuffer"],
	},
	fn: [
		["$noop", "cursor", "isPlaying", "previewBuffer", "previewStructure"] as const,
		(
			payload: unknown,
			noop: unknown,
			cursor: unknown,
			isPlaying: unknown,
			previewBuffer: unknown,
			previewStructure: unknown,
		) =>
			reduceSessionTickPlaybackAction(payload, {
				cursor: typeof cursor === "number" ? cursor : 0,
				isPlaying: Boolean(isPlaying),
				previewBuffer:
					previewBuffer && typeof previewBuffer === "object"
						? (previewBuffer as PreviewBuffer)
						: null,
				previewStructure:
					previewStructure &&
					typeof previewStructure === "object" &&
					Array.isArray(
						(previewStructure as { clipSources?: unknown }).clipSources,
					)
						? (previewStructure as PreviewStructure)
						: { clipSources: [] },
			}) ?? noop,
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
	fn: reduceSessionSetExportProgressAction,
} as const satisfies DktActionDescriptor;

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

export const sessionImportResourceIntoActiveProjectAction = {
	to: {
		resource: [
			"<< resource << #",
			{
				method: "at_end",
				can_create: true,
				can_hold_refs: true,
				creation_shape: RESOURCE_CREATION_SHAPE,
			},
		],
		projectResource: [
			"<< activeProject.resources",
			{
				method: "at_end",
				can_use_refs: true,
			},
		],
	},
	fn: [
		["<< @one:activeProject"] as const,
		(_payload: unknown, activeProject: unknown) => ({
			resource: {
				attrs: normalizeResourceCreationAttrs(_payload),
				rels: activeProject ? { project: activeProject } : undefined,
				hold_ref_id: "activeProjectImportResource",
			},
			projectResource: { use_ref_id: "activeProjectImportResource" },
		}),
	],
} as const satisfies DktActionDescriptor;

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
				const id = asString(value?.id) ?? createExportRequestId();
				const range: ExportProgressState["range"] = { type: "project" };
				const request = {
					id,
					range,
					format: "video-webm" as const,
					plan,
					requestedAt: Date.now(),
					initiatedBy,
				};
				return {
					exportRequest: request,
					exportProgress: createQueuedProgressState(id, range, initiatedBy),
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
				const id = asString(value?.id) ?? createExportRequestId();
				const range: ExportProgressState["range"] = { type: "clip", clipId };
				const request = {
					id,
					range,
					format: "video-webm" as const,
					plan,
					requestedAt: Date.now(),
					initiatedBy,
				};
				return {
					exportRequest: request,
					exportProgress: createQueuedProgressState(id, range, initiatedBy),
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
				const id = asString(value?.id) ?? createExportRequestId();
				const range: ExportProgressState["range"] = { type: "clip", clipId };
				const request = {
					id,
					range,
					format: "video-webm" as const,
					plan,
					requestedAt: Date.now(),
					initiatedBy,
				};
				return {
					exportRequest: request,
					exportProgress: createQueuedProgressState(id, range, initiatedBy),
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
	setPlaying: sessionSetPlayingAction,
	setTimelineZoom: sessionSetTimelineZoomAction,
	tickPlayback: sessionTickPlaybackAction,
	togglePlayback: sessionTogglePlaybackAction,
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
	setExportProgress: sessionSetExportProgressAction,
	clearExportProgress: sessionClearExportProgressAction,
} as const satisfies Record<DktSessionActionName, DktActionDefinition>;
