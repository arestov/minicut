import { model } from "dkt/model.js";
import {
	reduceRenameResource,
	reduceRequestAddToTimeline,
	reduceSetClipsRef,
	reduceSetProjectRef,
	reduceSetResourceAttrs,
	reduceSetResourceStatus,
} from "./Resource/actions";
import {
	finiteNumberOr,
	finiteNumberOrUndefined,
	objectOr,
	stringOr,
} from "./valueGuards";

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
	rels: {
		project: {},
	},
} as const;

export const Resource = model({
	model_name: "resource",
	crdt: {
		mode: "collaborative",
		attrs: {
			"$meta$removed": "lww",
			name: "lww",
			kind: "lww",
			url: "lww",
			mime: "lww",
			duration: "lww",
			width: "lww",
			height: "lww",
			size: "lww",
			source: "lww",
			status: { sync: false, reason: "effect-runtime" },
			data: "lww",
			timelineAddRequest: { sync: false, reason: "effect-runtime" },
		},
		rels: {
			project: "lww",
			clips: "or-set",
		},
	},
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
		status: [
			"input",
			"missing",
			{ aggregate: { name: "importPipeline", as: "status" } },
		],
		data: ["input", null],
		timelineAddRequest: [
			"input",
			null,
			{ aggregate: { name: "importPipeline", as: "timelineAddRequest" } },
		],
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
				resourceId: stringOr(resourceId, ""),
				name: stringOr(name, "Resource"),
				kind: stringOr(kind, "video"),
				duration: finiteNumberOr(duration, 0),
				url: stringOr(url, ""),
				mime: stringOr(mime, "application/octet-stream"),
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
				name: stringOr(name, "Resource"),
				kind: stringOr(kind, "video"),
				url: stringOr(url, ""),
				mime: stringOr(mime, "application/octet-stream"),
				duration: finiteNumberOr(duration, 0),
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
				resourceId: stringOr(resourceId, ""),
				name: stringOr(name, "Resource"),
				kind:
					kind === "audio" || kind === "image" || kind === "text"
						? kind
						: "video",
				url: stringOr(url, ""),
				mime: stringOr(mime, "application/octet-stream"),
				duration: finiteNumberOr(duration, 0),
				width: finiteNumberOrUndefined(width),
				height: finiteNumberOrUndefined(height),
				size: finiteNumberOrUndefined(size),
				source: objectOr(source, { kind: "local" }),
				status: stringOr(status, "missing"),
				data: objectOr(data, {}),
			}),
		],
	},
	rels: {
		project: [
			"input",
			{
				linking: "<< project << #",
				role: "nav",
				inverseRel: "resources",
				aggregate: { name: "resourceLifecycle", role: "mirror", as: "project" },
			},
		],
		clips: [
			"input",
			{
				many: true,
				linking: "<< clip << #",
				role: "ref",
				aggregate: {
					name: "resourceLifecycle",
					role: "evidence",
					as: "clips",
				},
			},
		],
	},
	actions: {
		renameResource: {
			to: {
				name: ["name"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceRenameResource(payload) ?? noop,
			],
		},
		removeSelf: {
			to: {
				"$meta$removed": ["$meta$removed"],
			},
			fn: () => ({ "$meta$removed": true }),
		},
		setResourceStatus: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "setResourceStatus",
				permission: "entry",
			},
			to: {
				status: ["status"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetResourceStatus(payload) ?? noop,
			],
		},
		setResourceAttrs: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "setResourceAttrs",
				permission: "entry",
			},
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
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetResourceAttrs(payload) ?? noop,
			],
		},
		requestAddToTimeline: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "requestAddToTimeline",
				permission: "entry",
			},
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
