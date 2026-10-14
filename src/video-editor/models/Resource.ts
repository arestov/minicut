import { model } from "dkt/model.js";
import { makePublicationManifest, acceptedPublication, publicationProposal, publicationTuple, recordOf, samePublicationCandidate, samePublicationTuple, samePublicationValue, copyPublicationValue, type AcceptedPublication } from "../media/mediaPublicationProtocol";
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
import { reduceBootRestoreStart } from "./mediaRestoreBoot";

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
		"audioStreams",
		"doneBoot",
		"localPublicationSequence",
		"localAcceptedPublication",
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

const describeDisplayNote = (
	status: unknown,
	localMediaAvailability: unknown,
	originalAccessStatus: unknown,
): { label: string; tone: "warning" | "danger" | "info" } | null => {
	switch (originalAccessStatus) {
		case "missing":
			return { label: "File missing", tone: "danger" };
		case "denied":
			return { label: "Access denied", tone: "danger" };
		case "prompt":
			return { label: "Needs permission", tone: "warning" };
	}
	if (status === "needs-permission") return { label: "Needs permission", tone: "warning" };
	if (status === "missing") return { label: "Source missing", tone: "danger" };
	if (localMediaAvailability === "ready-project-copy") return { label: "Using project copy", tone: "info" };
	return null;
};

const START_MEDIA_RECOVERY_STEPS = [
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
];

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
			audioStreams: "lww",
			timelineAddRequest: { sync: false, reason: "effect-runtime" },
			doneBoot: { sync: false, reason: "effect-runtime" },
			localPublicationSequence: { sync: false, reason: "effect-runtime" },
			localAcceptedPublication: { sync: false, reason: "effect-runtime" },
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
		// Audio streams found in the source at import; null = unknown, 0 = known silent.
		audioStreams: ["input", null],
		// Boot stamp of the last boot restore started (or import-covered) for this resource.
		doneBoot: ["input", null],
		localPublicationSequence: ["input", 0],
		localAcceptedPublication: ["input", null],
		localMediaPublicationOwnership: ["comp", ["localPublicationValidity", "< @all:publicationOwnership < mediaRecoveryTasks"] as const, (accepted: unknown, candidates: unknown) => makePublicationManifest(accepted ? [accepted] : [], candidates)],
localPublicationValidity: ["comp", ["localAcceptedPublication", "$meta$removed", "< @one:_node_id < project", "< @one:$meta$removed < project", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "url", "contentFingerprint", "fingerprintVersion", "duration", "width", "height", "localMediaAvailability", "originalAccessStatus"] as const,
			(acceptedValue: unknown, removed: unknown, projectId: unknown, projectRemoved: unknown, ...values: unknown[]) => {
				const accepted = acceptedValue as AcceptedPublication | null; if (!accepted) return null;
				const pointer = Object.fromEntries(["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "url", "contentFingerprint", "fingerprintVersion", "duration", "width", "height", "localMediaAvailability", "originalAccessStatus"].map((key, index) => [key, ["assetRef", "sourceRef", "contentFingerprint", "fingerprintVersion", "width", "height"].includes(key) ? values[index] ?? null : values[index]]));
				return { ...publicationTuple(accepted), accepted, pointer: accepted.pointer, assetRef: accepted.pointer.assetRef, handleRef: accepted.pointer.sourceKind === "file-handle" ? accepted.pointer.sourceRef : null, currentBacking: !removed && !projectRemoved && typeof projectId === "string" && projectId ? { projectId, assetRef: typeof pointer.assetRef === "string" ? pointer.assetRef : null, handleRef: pointer.sourceKind === "file-handle" && typeof pointer.sourceRef === "string" ? pointer.sourceRef : null } : null, eligible: !removed && !projectRemoved && projectId === accepted.projectId && samePublicationValue(pointer, accepted.pointer) };
			}],
		// Boot stamp while the owning project is attended and the platform can restore, else null.
		wantBoot: ["comp", ["< @one:attendedBoot < project"] as const, (boot: unknown) => boot ?? null],
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
		displayNote: [
			"comp",
			["status", "localMediaAvailability", "originalAccessStatus"] as const,
			describeDisplayNote,
		],
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
		renderSource: [
			"comp",
			["sourceKind", "sourceRef", "contentFingerprint", "fingerprintVersion"] as const,
			(
				sourceKind: unknown,
				sourceRef: unknown,
				contentFingerprint: unknown,
				fingerprintVersion: unknown,
			) => ({
				sourceKind: stringOr(sourceKind, "missing"),
				sourceRef: typeof sourceRef === "string" && sourceRef ? sourceRef : null,
				contentFingerprint:
					typeof contentFingerprint === "string" && contentFingerprint ? contentFingerprint : null,
				fingerprintVersion:
					typeof fingerprintVersion === "string" && fingerprintVersion ? fingerprintVersion : null,
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
	effects: {
		api: { mediaRecoveryRuntime: [["_node_id"] as const, ["#mediaRecoveryRuntime"] as const, (runtime: unknown) => runtime] },
		out: { $fx_mediaPublicationDecision: { api: ["mediaRecoveryRuntime"], create_when: { api_inits: false }, fn: (api: unknown, state: unknown) => { (api as { publishMediaPublicationDecision(payload: unknown): void }).publishMediaPublicationDecision(recordOf(state)?.payload); } } },
	},
	actions: {
		startMediaRecovery: START_MEDIA_RECOVERY_STEPS,
		"handleAttr:wantBoot": [
			{
				to: { doneBoot: ["doneBoot"], start: ["$output"] },
				fn: [
					["$noop", "doneBoot", "_node_id", "$now"] as const,
					reduceBootRestoreStart,
				],
			},
			...START_MEDIA_RECOVERY_STEPS,
		],
		completeMediaRecovery: {
			aggregate: { name: "importPipeline", as: "completeMediaRecovery", permission: "entry" },
			steps: [
			{
				to: { assetStorageKind: ["assetStorageKind"], assetRef: ["assetRef"], sourceKind: ["sourceKind"], sourceRef: ["sourceRef"], url: ["url"], contentFingerprint: ["contentFingerprint"], fingerprintVersion: ["fingerprintVersion"], duration: ["duration"], width: ["width"], height: ["height"], mime: ["mime"], size: ["size"], lastModified: ["lastModified"], localMediaAvailability: ["localMediaAvailability"], originalAccessStatus: ["originalAccessStatus"], localPublicationSequence: ["localPublicationSequence"], localAcceptedPublication: ["localAcceptedPublication"], forwarded: ["$output"] },
				fn: [["_node_id", "$meta$removed", "< @one:_node_id < project", "< @one:$meta$removed < project", "< @one:publicationState < activeMediaRecoveryTask", "localPublicationSequence", "localAcceptedPublication", "transferSnapshot"] as const,
					(payload: unknown, resourceId: unknown, removed: unknown, projectId: unknown, projectRemoved: unknown, taskValue: unknown, sequenceValue: unknown, previousValue: unknown, snapshotValue: unknown) => {
						const proposal = publicationProposal(payload); const tuple = publicationTuple(payload); const task = recordOf(taskValue); const snapshot = recordOf(snapshotValue); const previous = previousValue as AcceptedPublication | null;
						if (!tuple) return { forwarded: {} };
						const exact = Boolean(proposal && task && samePublicationCandidate(proposal, { ...task, resourceId, projectId }) && task.publicationRequested && task.phase === "committing" && !task.removed);
						const reject = (reason: string) => ({ forwarded: { ...tuple, kind: "rejected", reason, candidateDisposition: exact && !task?.publicationReceipt && !samePublicationTuple(previous, tuple) && (!proposal?.pointer.assetRef || proposal.pointer.assetRef !== snapshot?.assetRef) && (!proposal?.pointer.sourceRef || proposal.pointer.sourceRef !== snapshot?.sourceRef) ? "rollback-unaccepted" : "retain-uncertain" } });
						if (!proposal || !snapshot || !exact || removed || projectRemoved || resourceId !== tuple.resourceId || projectId !== tuple.projectId) return reject("publication-not-current");
						if (task?.publicationReceipt) return { forwarded: { decision: task.publicationReceipt, bindingEligibility: samePublicationValue(previous, task.publicationReceipt) ? "current" : "obsolete" } };
						const previousAbsent = previousValue === null || previousValue === undefined;
						const priorReceipt = previousAbsent ? null : acceptedPublication(previousValue);
						const sequenceBase = (sequenceValue === null || sequenceValue === undefined) && previousAbsent ? 0 : sequenceValue;
						if (!Number.isSafeInteger(sequenceBase) || (sequenceBase as number) < 0 || (sequenceBase as number) >= Number.MAX_SAFE_INTEGER || (!previousAbsent && (!priorReceipt || priorReceipt.resourceId !== resourceId || priorReceipt.sequence > (sequenceBase as number)))) return reject("publication-sequence-overflow");
						if (proposal.pointer.contentFingerprint !== proposal.candidateFingerprint || proposal.pointer.fingerprintVersion !== proposal.candidateFingerprintVersion || ["duration", "width", "height"].some((key) => Object.hasOwn(proposal.candidateMetadata, key) && !samePublicationValue(proposal.candidateMetadata[key], proposal.pointer[key as keyof typeof proposal.pointer]))) return reject("candidate-pointer-mismatch");
						const sequence = (sequenceBase as number) + 1;
						const acceptedResource = copyPublicationValue({ ...Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value ?? null])), projectId, ...proposal.pointer, ...proposal.candidateFileMetadata }) as Record<string, unknown>;
						const decision = { ...proposal, kind: "accepted", sequence, acceptedResource, previousAcceptedIdentityAndRefs: previous ? { ...publicationTuple(previous), sequence: previous.sequence, pointer: previous.pointer } : null };
						return { ...proposal.pointer, ...proposal.candidateFileMetadata, localPublicationSequence: sequence, localAcceptedPublication: decision, forwarded: { decision, bindingEligibility: "current" } };
					}],
			},
			{ when: [[] as const, (payload: unknown) => recordOf(recordOf(payload)?.decision)?.kind === "accepted"], to: { receipt: ["<< activeMediaRecoveryTask", { action: "recordPublicationDecision", sub_flow: true }], forwarded: ["$output"] }, fn: (payload: unknown) => ({ receipt: recordOf(payload)?.decision, forwarded: payload }) },
			{ when: [[] as const, (payload: unknown) => recordOf(recordOf(payload)?.decision)?.kind === "accepted" || recordOf(payload)?.kind === "rejected"], to: ["$fx_mediaPublicationDecision", { intent: "call", drop_when_api_not_ready: false }], fn: (payload: unknown) => payload },
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
			{
				to: { localMediaAvailability: ["localMediaAvailability"], originalAccessStatus: ["originalAccessStatus"], forwarded: ["$output"] },
				fn: [["$noop", "_node_id", "$meta$removed", "< @one:_node_id < project", "< @one:$meta$removed < project", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "localPublicationSequence", "localAcceptedPublication", "< @one:publicationState < activeMediaRecoveryTask"] as const,
					(payload: unknown, noop: unknown, resourceId: unknown, removed: unknown, projectId: unknown, projectRemoved: unknown, assetStorageKind: unknown, assetRef: unknown, sourceKind: unknown, sourceRef: unknown, sequence: unknown, accepted: unknown, taskValue: unknown) => {
						const value = recordOf(payload); const snapshot = recordOf(value?.restoreSnapshot); const task = recordOf(taskValue);
						const availability = value?.availability; const access = value?.originalAccess;
						const validAvailability = availability === "unknown" || availability === "resolving" || availability === "ready-project-copy" || availability === "ready-file-handle" || availability === "unavailable" || availability === "error";
						const validAccess = access === "unknown" || access === "granted" || access === "prompt" || access === "denied" || access === "missing";
						if (!validAvailability || !validAccess || removed || projectRemoved || task?.publicationRequested || task?.publicationReceipt) return noop;
						const ref = (entry: unknown) => typeof entry === "string" ? entry : null;
						if (snapshot) {
							if (snapshot.resourceId !== resourceId || snapshot.projectId !== projectId || snapshot.assetStorageKind !== assetStorageKind || ref(snapshot.assetRef) !== ref(assetRef) || snapshot.sourceKind !== sourceKind || ref(snapshot.sourceRef) !== ref(sourceRef) || ref(snapshot.handleRef) !== (sourceKind === "file-handle" ? ref(sourceRef) : null)) return noop;
							if (Object.hasOwn(snapshot, "publicationSequencePresent")) {
								if (typeof snapshot.publicationSequencePresent !== "boolean" || snapshot.publicationSequencePresent !== (sequence !== undefined) || snapshot.publicationSequence !== (sequence === undefined ? null : sequence)) return noop;
							} else if (snapshot.publicationSequence !== sequence) return noop;
						} else if (accepted || value?.restoreSnapshot != null) return noop;
						return { localMediaAvailability: availability, originalAccessStatus: access, forwarded: payload };
					}],
			},
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
