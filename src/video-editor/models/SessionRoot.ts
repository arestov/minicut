import { model } from "dkt/model.js";
import { SessionRoot as BaseSessionRoot } from "dkt-all/libs/provoda/bwlev/SessionRoot.js";
import type { ExportProgressState } from "../app/exportProgressState";
import type { ExportRequestState } from "../app/exportRequestState";
import type { PreviewBuffer } from "../read-model/previewComps";
import { dktSessionActions } from "./SessionRoot/actions";
import { WORKSPACE_OPEN_STATUS } from "../dkt/runtime/workspaceOpenState";
import {
	reducePreviewFrame,
	reducePreviewStructure,
	reduceSelectedClip,
} from "./SessionRoot/comps";
import { TIMELINE_ZOOM_DEFAULT } from "./sessionZoom";

const debugExport = (message: string, details?: unknown) => {
	if (
		(globalThis as { __MINICUT_EXPORT_DEBUG__?: unknown })
			.__MINICUT_EXPORT_DEBUG__ !== true
	) {
		return;
	}
	console.info("[minicut:export:session-root]", message, details);
};

export const EditorSessionRoot = model({
	extends: BaseSessionRoot,
	model_name: "session_root",
	aggregates: {
		sessionProjection: {
			kind: "projection",
			write: "local-only",
		},
	},
	attrs: {
		sessionKey: [
			"input",
			null,
			{ aggregate: { name: "sessionProjection", role: "projection", as: "sessionKey" } },
		],
		route: [
			"input",
			null,
			{ aggregate: { name: "sessionProjection", role: "projection", as: "route" } },
		],
		closedAt: [
			"input",
			null,
			{ aggregate: { name: "sessionProjection", role: "projection", as: "closedAt" } },
		],
		storageOpenStatus: [
			"input",
			WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "storageOpenStatus",
				},
			},
		],
		isCommonRoot: [
			"input",
			false,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "isCommonRoot",
				},
			},
		],
		tabId: [
			"input",
			null,
			{ aggregate: { name: "sessionProjection", role: "projection", as: "tabId" } },
		],
		activeProjectId: [
			"input",
			null,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "activeProjectId",
				},
			},
		],
		pendingProjectInit: [
			"input",
			null,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "pendingProjectInit",
				},
			},
		],
		selectedEntityId: [
			"input",
			null,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "selectedEntityId",
				},
			},
		],
		activeInspectorTab: [
			"input",
			"edit",
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "activeInspectorTab",
				},
			},
		],
		cursor: [
			"input",
			0,
			{ aggregate: { name: "sessionProjection", role: "projection", as: "cursor" } },
		],
		isPlaying: [
			"input",
			false,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "isPlaying",
				},
			},
		],
		previewBuffer: [
			"input",
			null as PreviewBuffer | null,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "previewBuffer",
				},
			},
		],
		exportRequest: [
			"input",
			null as ExportRequestState | null,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "exportRequest",
				},
			},
		],
		exportProgress: [
			"input",
			null as ExportProgressState | null,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "exportProgress",
				},
			},
		],
		timelineZoom: [
			"input",
			TIMELINE_ZOOM_DEFAULT,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "timelineZoom",
				},
			},
		],
		timelineTool: [
			"input",
			"select",
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "timelineTool",
				},
			},
		],
		snappingEnabled: [
			"input",
			true,
			{
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "snappingEnabled",
				},
			},
		],
		previewStructure: [
			"comp",
			["< @one:previewClipSources < activeProject"] as const,
			reducePreviewStructure,
		],
		previewFrame: [
			"comp",
			["previewStructure", "cursor", "previewBuffer", "isPlaying"] as const,
			reducePreviewFrame,
		],
		selectedClipSummary: [
			"comp",
			[
				"< @one:_node_id < selectedClip",
				"< @one:color < selectedClip",
				"< @one:name < selectedClip",
				"< @one:name < selectedClip.track",
			] as const,
			(
				clipId: unknown,
				color: unknown,
				clipName: unknown,
				trackName: unknown,
			) => {
				if (typeof clipId !== "string" || !clipId) return null;
				return {
					color: typeof color === "string" && color ? color : "#2563eb",
					resourceName:
						typeof clipName === "string" && clipName ? clipName : "Clip",
					trackName:
						typeof trackName === "string" && trackName ? trackName : "Track",
				};
			},
		],
		selectedClipTrackPosition: [
			"comp",
			[
				"<< @all:activeProject.tracks",
				"<< @one:selectedClip.track",
				"< @one:name < selectedClip.track",
			] as const,
			(tracks: unknown, selectedTrack: unknown, trackName: unknown) => {
				if (!selectedTrack) return null;
				const trackList = Array.isArray(tracks) ? tracks : [];
				const index = trackList.indexOf(selectedTrack);
				if (index === -1) return null;
				return {
					trackName:
						typeof trackName === "string" && trackName
							? trackName
							: `Track ${index + 1}`,
					ordinal: index + 1,
				};
			},
		],
	},
	effects: {
		api: {
			exportRuntime: [
				["_node_id"] as const,
				["#exportRuntime"] as const,
				(exportRuntime: unknown) => exportRuntime,
			],
			importRuntime: [
				["_node_id"] as const,
				["#importRuntime"] as const,
				(importRuntime: unknown) => importRuntime,
			],
		},
		out: {
			$fx_handleInputFiles: {
				api: ["importRuntime"],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as {
						requestImportFiles?: (payload: unknown) => void;
					} | null;
					const payload = (state as { payload?: unknown } | null)?.payload;
					if (
						!runtime ||
						typeof runtime.requestImportFiles !== "function" ||
						!payload ||
						typeof payload !== "object"
					) {
						return;
					}
					runtime.requestImportFiles(payload);
				},
			},
			$fx_renderExport: {
				api: ["exportRuntime"],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as {
						requestExport?: (payload: unknown) => void;
					} | null;
					const payload = (state as { payload?: unknown } | null)?.payload;
					const request =
						payload && typeof payload === "object"
							? (payload as { request?: unknown }).request
							: null;
					if (
						!runtime ||
						typeof runtime.requestExport !== "function" ||
						!request ||
						typeof request !== "object"
					) {
						debugExport("skip $fx_renderExport effect", {
							hasRuntime: Boolean(
								runtime && typeof runtime.requestExport === "function",
							),
							hasPayload: Boolean(request),
						});
						return;
					}

					debugExport("$fx_renderExport effect -> runtime", {
						id: (request as { id?: unknown }).id,
						range: (request as { range?: unknown }).range,
					});
					runtime.requestExport(payload);
				},
			},
		},
	},
	rels: {
		activeProject: [
			"input",
			{
				linking: "<< project << #",
				role: "projection",
				aggregate: { name: "sessionProjection", role: "projection", as: "activeProject" },
			},
		],
		selectedTrack: [
			"input",
			{
				linking: "<< track << #",
				role: "projection",
				aggregate: { name: "sessionProjection", role: "projection", as: "selectedTrack" },
			},
		],
		selectedClip: [
			"comp",
			["<< @all:activeProject.tracks.clips", "selectedEntityId"] as const,
			reduceSelectedClip,
			{
				linking: "<< clip << #",
				role: "projection",
				aggregate: { name: "sessionProjection", role: "projection", as: "selectedClip" },
			},
		],
		selectedResource: [
			"input",
			{
				linking: "<< resource << #",
				role: "projection",
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "selectedResource",
				},
			},
		],
		selectedText: [
			"input",
			{
				linking: "<< text << #",
				role: "projection",
				aggregate: { name: "sessionProjection", role: "projection", as: "selectedText" },
			},
		],
		selectedEffect: [
			"input",
			{
				linking: "<< effect << #",
				role: "projection",
				aggregate: {
					name: "sessionProjection",
					role: "projection",
					as: "selectedEffect",
				},
			},
		],
	},
	actions: dktSessionActions,
});
