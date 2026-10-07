import { model } from "dkt/model.js";
import { crdtReviewResolveTarget } from "../dkt/review/crdtReviewCommands";
import {
	reduceKeepOfflinePlaceholder,
	reduceRenameResource,
	reduceRequestAddToTimeline,
	reduceResolveDanglingResourceByRelink,
	reduceSetClipsRef,
	reduceSetResourceAttrs,
	reduceSetResourceStatus,
} from "./Resource/actions";
import {
	finiteNumberOr,
	finiteNumberOrUndefined,
	objectOr,
	stringOr,
} from "./valueGuards";
import { MEDIA_RECOVERY_TASK_CREATION_SHAPE } from "./MediaRecoveryTask";

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
		"lastModified",
		"sourceKind",
		"sourceRef",
		"source",
		"status",
		"data",
		"assetStorageKind",
		"assetRef",
		"contentFingerprint",
		"fingerprintVersion",
		"localMediaStatus",
		"localMediaAvailability",
		"originalAccessStatus",
	],
	rels: {
		project: {},
	},
} as const;

const isPortableResourceUrl = (url: string): boolean =>
	url.startsWith("data:") ||
	url.startsWith("http://") ||
	url.startsWith("https://") ||
	url.startsWith("/") ||
	url.startsWith("./");

const portableResourceUrlOrEmpty = (url: unknown): string => {
	const value = stringOr(url, "");
	return isPortableResourceUrl(value) ? value : "";
};

export const Resource = model({
	model_name: "resource",
	crdt: {
		mode: "collaborative",
		attrs: {
			"$meta$removed": "lww",
			name: "lww",
			kind: "lww",
			url: { sync: false, reason: "effect-runtime" },
			mime: "lww",
			duration: "lww",
			width: "lww",
			height: "lww",
			size: "lww",
			lastModified: "lww",
			sourceKind: "lww",
			sourceRef: "lww",
			source: "lww",
			status: "lww",
			data: { sync: false, reason: "effect-runtime" },
			assetStorageKind: "lww",
			assetRef: "lww",
			contentFingerprint: "lww",
			fingerprintVersion: "lww",
			localMediaStatus: { sync: false, reason: "effect-runtime" },
			localMediaAvailability: { sync: false, reason: "effect-runtime" },
			originalAccessStatus: { sync: false, reason: "effect-runtime" },
			timelineAddRequest: { sync: false, reason: "effect-runtime" },
		},
			rels: {
			project: { sync: false, reason: "framework-owned" },
			clips: "or-set",
			activeMediaRecoveryTask: { sync: false, reason: "effect-runtime" },
			mediaRecoveryTasks: { sync: false, reason: "effect-runtime" },
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
		lastModified: ["input", null],
		sourceKind: ["input", "missing"],
		sourceRef: ["input", null],
		source: ["input", { kind: "local" }],
		status: ["input", "missing"],
		data: ["input", null],
		assetStorageKind: ["input", "linked"],
		assetRef: ["input", null],
		contentFingerprint: ["input", null],
		fingerprintVersion: ["input", null],
		localMediaStatus: ["input", "unknown"],
		localMediaAvailability: ["input", "unknown"],
		originalAccessStatus: ["input", "unknown"],
		requiredSourceEnd: [
			"comp",
			["< @all:in < clips", "< @all:duration < clips"] as const,
			(inPoints: unknown, durations: unknown) => {
				if (!Array.isArray(inPoints) || !Array.isArray(durations)) return 0;
				return inPoints.reduce((maximum, value, index) => {
					const duration = durations[index];
					return typeof value === "number" && Number.isFinite(value) && typeof duration === "number" && Number.isFinite(duration)
						? Math.max(maximum, value + duration)
						: maximum;
				}, 0);
			},
		],
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
				url: portableResourceUrlOrEmpty(url),
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
				url: portableResourceUrlOrEmpty(url),
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
				"lastModified",
				"sourceKind",
				"sourceRef",
				"source",
				"status",
				"data",
				"assetStorageKind",
				"assetRef",
				"contentFingerprint",
				"fingerprintVersion",
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
				lastModified: unknown,
				sourceKind: unknown,
				sourceRef: unknown,
				source: unknown,
				status: unknown,
				data: unknown,
				assetStorageKind: unknown,
				assetRef: unknown,
				contentFingerprint: unknown,
				fingerprintVersion: unknown,
			) => ({
				resourceId: stringOr(resourceId, ""),
				name: stringOr(name, "Resource"),
				kind:
					kind === "audio" || kind === "image" || kind === "text"
						? kind
						: "video",
				url: portableResourceUrlOrEmpty(url),
				mime: stringOr(mime, "application/octet-stream"),
				duration: finiteNumberOr(duration, 0),
				width: finiteNumberOrUndefined(width),
				height: finiteNumberOrUndefined(height),
				size: finiteNumberOrUndefined(size),
				lastModified: finiteNumberOrUndefined(lastModified) ?? null,
				sourceKind: stringOr(sourceKind, "missing"),
				sourceRef:
					typeof sourceRef === "string" && sourceRef ? sourceRef : null,
				source: objectOr(source, { kind: "local" }),
				status: stringOr(status, "missing"),
				data: objectOr(data, {}),
				assetStorageKind: assetStorageKind === "project-copy" ? "project-copy" : "linked",
				assetRef: typeof assetRef === "string" ? assetRef : null,
				contentFingerprint: typeof contentFingerprint === "string" ? contentFingerprint : null,
				fingerprintVersion: typeof fingerprintVersion === "string" ? fingerprintVersion : null,
			}),
		],
	},
	rels: {
		project: [
			"input",
			{
				linking: "<< project << #",
				inverseRel: "resources",
				inverseOf: { project: "resources" },
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
		activeMediaRecoveryTask: [
			"input",
			{
				linking: "<< mediaRecoveryTasks",
				role: "projection",
			},
		],
		mediaRecoveryTasks: [
			"input",
			{
				many: true,
				linking: "<< mediaRecoveryTask << #",
				role: "owner",
				ownership: "slot-single",
				inverseRel: "resource",
			},
		],
	},
	actions: {
		startMediaRecovery: [
			{
				to: {
					oldTask: ["<< activeMediaRecoveryTask", { action: "supersedeForAttempt", sub_flow: true }],
					forwarded: ["$output"],
				},
				fn: (payload: unknown) => ({ oldTask: payload, forwarded: payload }),
			},
			{
				to: {
					createdTask: ["<< mediaRecoveryTasks", { method: "at_end", can_create: true, can_hold_refs: true, creation_shape: MEDIA_RECOVERY_TASK_CREATION_SHAPE }],
					forwarded: ["$output"],
				},
				output_base_rel_shape: { task: { linking: "<< mediaRecoveryTasks", many: false } },
				fn: [
					["$noop", "< @one:bootId < activeMediaRecoveryTask", "< @one:recoveryKind < activeMediaRecoveryTask"] as const,
					(payload: unknown, noop: unknown, activeBootId: unknown, activeRecoveryKind: unknown) => {
						const value = payload as Record<string, unknown> | null;
						if (!value || typeof value.operationId !== "string" || typeof value.bootId !== "string" || typeof value.recoveryKind !== "string") return noop;
						if (value.bootId === activeBootId && value.recoveryKind === activeRecoveryKind) return noop;
						return {
							createdTask: {
								attrs: {
									operationId: value.operationId,
									attemptId: value.attemptId,
									bootId: value.bootId,
									recoveryKind: value.recoveryKind,
									intent: value.intent,
									runtimeHandleId: value.runtimeHandleId ?? null,
									phase: "created",
									createdAt: value.createdAt,
									updatedAt: value.updatedAt,
								},
								hold_ref_id: "newMediaRecoveryTask",
							},
							forwarded: { ...value, task: { use_ref_id: "newMediaRecoveryTask" } },
						};
					},
				],
			},
			{
				input_base_rel_shape: { task: { linking: "<< mediaRecoveryTasks", many: false } },
				when: [[] as const, (payload: unknown) => Boolean((payload as { task?: unknown } | null)?.task)],
				to: {
					activeMediaRecoveryTask: ["<< activeMediaRecoveryTask", { method: "set_one", can_use_refs: true }],
					forwarded: ["$output"],
				},
				output_base_rel_shape: { task: { linking: "<< mediaRecoveryTasks", many: false } },
				fn: (payload: unknown) => ({ activeMediaRecoveryTask: (payload as { task?: unknown } | null)?.task ?? null, forwarded: payload }),
			},
			{
				input_base_rel_shape: { task: { linking: "<< mediaRecoveryTasks", many: false } },
				to: ["<<<< $input:task", { action: "runRecoveryEffect", sub_flow: true }],
				fn: (payload: unknown) => payload,
			},
		],
		completeMediaRecovery: {
			aggregate: {
				name: "importPipeline",
				as: "completeMediaRecovery",
				permission: "entry",
			},
			to: {
				assetStorageKind: ["assetStorageKind"], assetRef: ["assetRef"], sourceKind: ["sourceKind"], sourceRef: ["sourceRef"], url: ["url"], contentFingerprint: ["contentFingerprint"], fingerprintVersion: ["fingerprintVersion"], duration: ["duration"], width: ["width"], height: ["height"], localMediaAvailability: ["localMediaAvailability"], originalAccessStatus: ["originalAccessStatus"],
			},
			fn: [
				["duration", "width", "height"] as const,
				(payload: unknown, duration: unknown, width: unknown, height: unknown) => {
					const value = payload as Record<string, unknown> | null;
					if (!value) return {};
					return {
						assetStorageKind: value.assetStorageKind,
						assetRef: value.assetRef ?? null,
						sourceKind: value.sourceKind,
						sourceRef: value.sourceRef ?? null,
						url: typeof value.url === "string" ? value.url : "",
						contentFingerprint: value.contentFingerprint ?? null,
						fingerprintVersion: value.fingerprintVersion ?? null,
						duration: typeof value.duration === "number" ? value.duration : duration,
						width: typeof value.width === "number" ? value.width : width ?? null,
						height: typeof value.height === "number" ? value.height : height ?? null,
						localMediaAvailability: value.localMediaAvailability,
						originalAccessStatus: value.originalAccessStatus,
					};
				},
			],
		},
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
		setLocalMediaStatus: {
			to: { localMediaStatus: ["localMediaStatus"] },
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) => {
					const status = typeof payload === "string" ? payload : (payload as { status?: unknown } | null)?.status;
					return status === "unknown" || status === "resolving" || status === "ready-project-copy" || status === "ready-file-handle" || status === "needs-permission" || status === "permission-denied" || status === "missing" || status === "error"
						? { localMediaStatus: status }
						: noop;
				},
			],
		},
		setLocalMediaAxes: {
			to: { localMediaAvailability: ["localMediaAvailability"], originalAccessStatus: ["originalAccessStatus"] },
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) => {
					const value = payload as { availability?: unknown; originalAccess?: unknown } | null;
					const availability = value?.availability;
					const access = value?.originalAccess;
					const validAvailability = availability === "unknown" || availability === "resolving" || availability === "ready-project-copy" || availability === "ready-file-handle" || availability === "unavailable" || availability === "error";
					const validAccess = access === "unknown" || access === "granted" || access === "prompt" || access === "denied" || access === "missing";
					return validAvailability && validAccess ? { localMediaAvailability: availability, originalAccessStatus: access } : noop;
				},
			],
		},
		recordAutomaticMediaRecovery: [
			{ to: { localMediaAvailability: ["localMediaAvailability"], originalAccessStatus: ["originalAccessStatus"], forwarded: ["$output"] }, fn: (payload: unknown) => { const value = payload as { availability?: unknown; originalAccess?: unknown } | null; return { localMediaAvailability: value?.availability, originalAccessStatus: value?.originalAccess, forwarded: payload }; } },
			{ to: ["<< activeMediaRecoveryTask", { action: "recordRestoreState", sub_flow: true }], fn: (payload: unknown) => payload },
		],
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
				lastModified: ["lastModified"],
				sourceKind: ["sourceKind"],
				sourceRef: ["sourceRef"],
				source: ["source"],
				status: ["status"],
				data: ["data"],
				assetStorageKind: ["assetStorageKind"],
				assetRef: ["assetRef"],
				contentFingerprint: ["contentFingerprint"],
				fingerprintVersion: ["fingerprintVersion"],
				localMediaStatus: ["localMediaStatus"],
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
			fn: [
				["$now"] as const,
				(payload: unknown, now: unknown) =>
					reduceRequestAddToTimeline(payload, now),
			],
		},
		setClips: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: reduceSetClipsRef,
		},
		resolveDanglingResourceByRelink: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "resolveDanglingResourceByRelink",
				permission: "entry",
			},
			to: {
				"$meta$removed": ["$meta$removed"],
				url: ["url"],
				status: ["status"],
				source: ["source"],
				data: ["data"],
				crdtResolve: [crdtReviewResolveTarget],
			},
			fn: [
				["$noop", "<<<<", "<< @all:clips"] as const,
				(payload: unknown, noop: unknown, resource: unknown, clips: unknown) =>
					reduceResolveDanglingResourceByRelink(payload, resource, clips) ??
					noop,
			],
		},
		keepOfflinePlaceholder: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "keepOfflinePlaceholder",
				permission: "entry",
			},
			to: {
				"$meta$removed": ["$meta$removed"],
				status: ["status"],
				source: ["source"],
				crdtResolve: [crdtReviewResolveTarget],
			},
			fn: [
				["$noop", "<<<<", "<< @all:clips", "source"] as const,
				(
					payload: unknown,
					noop: unknown,
					resource: unknown,
					clips: unknown,
					source: unknown,
				) =>
					reduceKeepOfflinePlaceholder(payload, resource, clips, source) ??
					noop,
			],
		},
	},
});
