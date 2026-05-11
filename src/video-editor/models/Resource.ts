import { model } from "dkt/model.js";
import {
	reduceRenameResource,
	reduceRequestAddToTimeline,
	reduceSetClipsRef,
	reduceSetProjectRef,
	reduceSetResourceAttrs,
	reduceSetResourceStatus,
} from "./Resource/actions";

export const RESOURCE_CREATION_SHAPE = {
	attrs: [
		"name",
		"kind",
		"url",
		"mime",
		"duration",
		"width",
		"height",
		"size",
		"source",
		"status",
		"data",
	],
} as const;

export const Resource = model({
	model_name: "resource",
	attrs: {
		name: ["input", "Resource"],
		kind: ["input", "video"],
		url: ["input", ""],
		mime: ["input", "application/octet-stream"],
		duration: ["input", 0],
		width: ["input", null],
		height: ["input", null],
		size: ["input", null],
		source: ["input", { kind: "local" }],
		status: ["input", "missing"],
		data: ["input", null],
		timelineAddRequest: ["input", null],
		isReady: ["comp", ["status"], (status: unknown) => status === "ready"],
		timelineClipSource: [
			"comp",
			["_node_id", "name", "kind", "duration", "url", "mime"] as const,
			(
				resourceId: unknown,
				name: unknown,
				kind: unknown,
				duration: unknown,
				url: unknown,
				mime: unknown,
			) => ({
				resourceId: typeof resourceId === "string" ? resourceId : "",
				name: typeof name === "string" ? name : "Resource",
				kind: typeof kind === "string" ? kind : "video",
				duration:
					typeof duration === "number" && Number.isFinite(duration)
						? duration
						: 0,
				url: typeof url === "string" ? url : "",
				mime: typeof mime === "string" ? mime : "application/octet-stream",
			}),
		],
		renderSummary: [
			"comp",
			["name", "kind", "url", "mime", "duration"] as const,
			(
				name: unknown,
				kind: unknown,
				url: unknown,
				mime: unknown,
				duration: unknown,
			) => ({
				name: typeof name === "string" ? name : "Resource",
				kind: typeof kind === "string" ? kind : "video",
				url: typeof url === "string" ? url : "",
				mime: typeof mime === "string" ? mime : "application/octet-stream",
				duration:
					typeof duration === "number" && Number.isFinite(duration)
						? duration
						: 0,
			}),
		],
		transferSnapshot: [
			"comp",
			[
				"_node_id",
				"name",
				"kind",
				"url",
				"mime",
				"duration",
				"width",
				"height",
				"size",
				"source",
				"status",
				"data",
			] as const,
			(
				resourceId: unknown,
				name: unknown,
				kind: unknown,
				url: unknown,
				mime: unknown,
				duration: unknown,
				width: unknown,
				height: unknown,
				size: unknown,
				source: unknown,
				status: unknown,
				data: unknown,
			) => ({
				resourceId: typeof resourceId === "string" ? resourceId : "",
				name: typeof name === "string" ? name : "Resource",
				kind:
					kind === "audio" || kind === "image" || kind === "text"
						? kind
						: "video",
				url: typeof url === "string" ? url : "",
				mime: typeof mime === "string" ? mime : "application/octet-stream",
				duration:
					typeof duration === "number" && Number.isFinite(duration)
						? duration
						: 0,
				width:
					typeof width === "number" && Number.isFinite(width)
						? width
						: undefined,
				height:
					typeof height === "number" && Number.isFinite(height)
						? height
						: undefined,
				size:
					typeof size === "number" && Number.isFinite(size) ? size : undefined,
				source:
					source && typeof source === "object"
						? (source as Record<string, unknown>)
						: { kind: "local" },
				status: typeof status === "string" ? status : "missing",
				data:
					data && typeof data === "object"
						? (data as Record<string, unknown>)
						: {},
			}),
		],
	},
	rels: {
		project: ["input", { linking: "<< project << #" }],
		clips: ["input", { many: true, linking: "<< clip << #" }],
	},
	actions: {
		renameResource: {
			to: {
				name: ["name"],
			},
			fn: reduceRenameResource,
		},
		setResourceStatus: {
			to: {
				status: ["status"],
			},
			fn: reduceSetResourceStatus,
		},
		setResourceAttrs: {
			to: {
				name: ["name"],
				kind: ["kind"],
				url: ["url"],
				mime: ["mime"],
				duration: ["duration"],
				width: ["width"],
				height: ["height"],
				size: ["size"],
				source: ["source"],
				status: ["status"],
				data: ["data"],
			},
			fn: reduceSetResourceAttrs,
		},
		requestAddToTimeline: {
			to: {
				timelineAddRequest: ["timelineAddRequest"],
			},
			fn: reduceRequestAddToTimeline,
		},
		setProject: {
			to: {
				project: ["<< project", { method: "set_one" }],
			},
			fn: reduceSetProjectRef,
		},
		setClips: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: reduceSetClipsRef,
		},
	},
});
