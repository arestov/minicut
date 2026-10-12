import { model } from "dkt/model.js";
import { PUBLICATION_STATE_DEPS, publicationState, copyPublicationValue, acceptedPublication, publicationProposal, publicationTuple, recordOf, samePublicationCandidate, samePublicationTuple, samePublicationValue, type AcceptedPublication } from "../media/mediaPublicationProtocol";

export const MEDIA_RECOVERY_PHASES = [
	"created",
	"inspecting",
	"awaiting-user-action",
	"rejected",
	"failed",
	"ready-to-commit",
	"awaiting-confirmation",
	"committing",
	"completed",
	"cancelled",
	"interrupted",
	"superseded",
] as const;

export type MediaRecoveryPhase = (typeof MEDIA_RECOVERY_PHASES)[number];

export const MEDIA_RECOVERY_TASK_CREATION_SHAPE = {
	attrs: [
		"operationId",
		"attemptId",
		"bootId",
		"recoveryKind",
		"intent",
		"runtimeHandleId",
		"phase",
		"candidateMetadata",
		"candidateFingerprint",
		"candidateFingerprintVersion",
		"compatibility",
		"reasonCode",
		"errorMessage",
		"confirmationRequired",
		"publicationRequested",
		"publicationReceipt",
		"publicationBindingResult",
		"stagedAssetRef",
		"stagedHandleRef",
		"createdAt",
		"updatedAt",
		"interrupted",
		"outcome",
	],
	rels: { resource: {} },
} as const;

const TERMINAL_PHASES = new Set<MediaRecoveryPhase>([
	"rejected",
	"failed",
	"completed",
	"cancelled",
	"interrupted",
	"superseded",
]);

const TRANSITIONS: Record<MediaRecoveryPhase, ReadonlySet<MediaRecoveryPhase>> = {
	created: new Set(["inspecting", "cancelled", "interrupted", "superseded"]),
	inspecting: new Set(["awaiting-user-action", "rejected", "failed", "ready-to-commit", "awaiting-confirmation", "cancelled", "interrupted", "superseded"]),
	"awaiting-user-action": new Set(["inspecting", "cancelled", "interrupted", "superseded"]),
	rejected: new Set(),
	failed: new Set(),
	"ready-to-commit": new Set(["committing", "cancelled", "interrupted", "superseded"]),
	"awaiting-confirmation": new Set(["ready-to-commit", "cancelled", "interrupted", "superseded"]),
	committing: new Set(["completed", "failed", "interrupted", "superseded"]),
	completed: new Set(["superseded"]),
	cancelled: new Set(),
	interrupted: new Set(),
	superseded: new Set(),
};

const phaseOf = (value: unknown): MediaRecoveryPhase | null =>
	typeof value === "string" && (MEDIA_RECOVERY_PHASES as readonly string[]).includes(value)
		? (value as MediaRecoveryPhase)
		: null;

export const MediaRecoveryTask = model({
	model_name: "media_recovery_task",
	crdt: { mode: "local" },
	attrs: {
		operationId: ["input", ""],
		attemptId: ["input", ""],
		bootId: ["input", ""],
		recoveryKind: ["input", "restore"],
		intent: ["input", "restore"],
		runtimeHandleId: ["input", null],
		phase: ["input", "created"],
		candidateMetadata: ["input", null],
		candidateFingerprint: ["input", null],
		candidateFingerprintVersion: ["input", null],
		compatibility: ["input", null],
		reasonCode: ["input", null],
		errorMessage: ["input", null],
		confirmationRequired: ["input", false],
		publicationRequested: ["input", false],
		publicationReceipt: ["input", null],
		publicationBindingResult: ["input", null],
		publicationState: ["comp", PUBLICATION_STATE_DEPS, publicationState],
		publicationOwnership: ["comp", ["publicationState", "< @one:_node_id < resource", "< @one:$meta$removed < resource", "< @one:_node_id < resource.project", "< @one:$meta$removed < resource.project", "< @one:_node_id < resource.activeMediaRecoveryTask"] as const,
			(stateValue: unknown, resourceId: unknown, removed: unknown, projectId: unknown, projectRemoved: unknown, activeTaskId: unknown) => {
				const state = recordOf(stateValue);
				if (!state || typeof resourceId !== "string" || typeof projectId !== "string" || !state.operationId || !state.attemptId || !state.bootId) return null;
				const receipt = state.publicationReceipt as AcceptedPublication | null;
				if (receipt) return null;
				const tuple = publicationTuple({ projectId, resourceId, taskId: state.taskId, operationId: state.operationId, attemptId: state.attemptId, bootId: state.bootId, runtimeHandleId: state.runtimeHandleId ?? null });
				if (!tuple) return null;
				return { ...tuple, accepted: null, pointer: null, assetRef: state.stagedAssetRef ?? null, handleRef: state.stagedHandleRef ?? null, eligible: !removed && !projectRemoved && !state.removed && activeTaskId === state.taskId && !TERMINAL_PHASES.has(state.phase as MediaRecoveryPhase) };
			}],
		stagedAssetRef: ["input", null],
		stagedHandleRef: ["input", null],
		createdAt: ["input", null],
		updatedAt: ["input", null],
		interrupted: ["input", false],
		outcome: ["input", null],
	},
	rels: {
		resource: [
			"input",
			{
				linking: "<< resource << #",
				inverseRel: "mediaRecoveryTasks",
				inverseOf: { resource: "mediaRecoveryTasks" },
			},
		],
	},
	actions: {
		runRecoveryEffect: [
			{
				to: { phase: ["phase"], forwarded: ["$output"] },
				fn: [
					["$noop", "operationId", "phase"] as const,
					(payload: unknown, noop: unknown, operationId: unknown, phase: unknown) => {
						const value = payload as Record<string, unknown> | null;
						if (!value || value.operationId !== operationId || (phase !== "created" && phase !== "awaiting-user-action")) return noop;
						return { phase: "inspecting", forwarded: value };
					},
				],
			},
			{
				to: ["$fx_mediaRecovery", { intent: "call", drop_when_api_not_ready: false }],
				fn: [
					["$noop", "_node_id", "operationId", "bootId", "intent", "attemptId", "< @one:_node_id < resource.project", "< @one:_node_id < resource", "< @one:kind < resource", "< @one:duration < resource", "< @one:width < resource", "< @one:height < resource", "< @one:contentFingerprint < resource", "< @one:fingerprintVersion < resource", "< @one:requiredSourceEnd < resource", "< @one:sourceKind < resource", "< @one:sourceRef < resource", "< @one:assetStorageKind < resource", "< @one:assetRef < resource", "< @one:localPublicationSequence < resource"] as const,
					(payload: unknown, noop: unknown, taskId: unknown, operationId: unknown, bootId: unknown, intent: unknown, attemptId: unknown, projectId: unknown, resourceId: unknown, kind: unknown, duration: unknown, width: unknown, height: unknown, contentFingerprint: unknown, fingerprintVersion: unknown, requiredSourceEnd: unknown, sourceKind: unknown, sourceRef: unknown, assetStorageKind: unknown, assetRef: unknown, publicationSequence: unknown) => {
						const value = payload as Record<string, unknown> | null;
						if (!value || typeof taskId !== "string" || typeof resourceId !== "string") return noop;
						const normalizedSourceRef = typeof sourceRef === "string" ? sourceRef : null;
						const restoreSnapshot = copyPublicationValue({ resourceId, projectId, assetStorageKind, assetRef: typeof assetRef === "string" ? assetRef : null, sourceKind, sourceRef: normalizedSourceRef, handleRef: sourceKind === "file-handle" ? normalizedSourceRef : null, publicationSequence });
						return { taskId, resourceId, projectId, attemptId, operationId, bootId, intent, runtimeHandleId: value.runtimeHandleId ?? null, restoreSnapshot, original: { kind, duration, width: typeof width === "number" ? width : null, height: typeof height === "number" ? height : null, frameRate: null, timebase: null, audioChannels: null, audioSampleRate: null, streams: { videoStreams: kind === "video" ? 1 : 0, audioStreams: kind === "audio" ? 1 : null } }, originalFingerprint: contentFingerprint, fingerprintVersion, requiredSourceEnd, sourceKind, sourceRef };
					},
				],
			},
		],
		recordInspection: {
			to: { phase: ["phase"], candidateMetadata: ["candidateMetadata"], candidateFingerprint: ["candidateFingerprint"], candidateFingerprintVersion: ["candidateFingerprintVersion"], compatibility: ["compatibility"], reasonCode: ["reasonCode"], errorMessage: ["errorMessage"], confirmationRequired: ["confirmationRequired"], updatedAt: ["updatedAt"] },
			fn: [
				["$noop", "operationId", "phase"] as const,
				(payload: unknown, noop: unknown, operationId: unknown, phase: unknown) => {
					const value = payload as Record<string, unknown> | null;
					if (!value || value.operationId !== operationId || phase !== "inspecting") return noop;
					let candidateMetadata: unknown;
try { candidateMetadata = copyPublicationValue(value.candidateMetadata ?? null); } catch { return noop; }
const classification = value.classification;
					const nextPhase = classification === "incompatible" ? "rejected" : value.confirmationRequired === true ? "awaiting-confirmation" : "ready-to-commit";
					return { phase: nextPhase, candidateMetadata, candidateFingerprint: value.candidateFingerprint ?? null, candidateFingerprintVersion: value.candidateFingerprintVersion ?? null, compatibility: value.compatibility ?? null, reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : null, errorMessage: null, confirmationRequired: value.confirmationRequired === true, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null };
				},
			],
		},
		recordRestoreState: {
			to: { phase: ["phase"], reasonCode: ["reasonCode"], errorMessage: ["errorMessage"], updatedAt: ["updatedAt"], outcome: ["outcome"] },
			fn: [["$noop", "phase", "publicationRequested", "publicationReceipt"] as const, (payload: unknown, noop: unknown, phase: unknown, requested: unknown, receipt: unknown) => {
				const value = payload as { availability?: unknown; originalAccess?: unknown; updatedAt?: unknown } | null;
				if (!value || requested || receipt || phase === "committing" || phase === "completed" || phase === "superseded" || phase === "interrupted") return noop;
				const ready = value.availability === "ready-project-copy" || value.availability === "ready-file-handle";
				return { phase: ready ? "completed" : "awaiting-user-action", reasonCode: ready ? null : value.originalAccess === "denied" ? "permission-denied" : value.originalAccess === "prompt" ? "permission-required" : "source-missing", errorMessage: null, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null, outcome: ready ? "completed" : null };
			}],
		},
		requestCommit: [
			{ to: { phase: ["phase"], publicationRequested: ["publicationRequested"], forwarded: ["$output"] }, fn: [["$noop", "operationId", "phase"] as const,
				(payload: unknown, noop: unknown, operationId: unknown, phase: unknown) => { const value = recordOf(payload); return value?.operationId === operationId && (phase === "ready-to-commit" || phase === "awaiting-confirmation") ? { phase: "committing", publicationRequested: true, forwarded: value } : noop; }] },
			{ to: ["$fx_mediaRecoveryCommit", { intent: "call", drop_when_api_not_ready: false }], fn: [["$noop", "publicationState", "< @one:_node_id < resource", "< @one:_node_id < resource.project", "< @one:transferSnapshot < resource"] as const,
				(payload: unknown, noop: unknown, rawState: unknown, resourceId: unknown, projectId: unknown, transferSnapshot: unknown) => { const state = recordOf(rawState); const snapshot = recordOf(transferSnapshot); return state && state.publicationRequested && state.phase === "committing" && recordOf(payload)?.operationId === state.operationId && snapshot && typeof resourceId === "string" && typeof projectId === "string" ? { mode: "commit", projectId, resourceId, taskId: state.taskId, operationId: state.operationId, attemptId: state.attemptId, bootId: state.bootId, runtimeHandleId: state.runtimeHandleId, candidateMetadata: state.candidateMetadata, candidateFingerprint: state.candidateFingerprint, candidateFingerprintVersion: state.candidateFingerprintVersion, sourceKind: snapshot.sourceKind, sourceRef: snapshot.sourceRef, transferSnapshot: copyPublicationValue(Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value ?? null]))) } : noop; }] },
		],
		transition: {
			to: {
				phase: ["phase"],
				reasonCode: ["reasonCode"],
				errorMessage: ["errorMessage"],
				updatedAt: ["updatedAt"],
				interrupted: ["interrupted"],
				outcome: ["outcome"],
			},
			fn: [
				["$noop", "phase", "operationId", "publicationRequested"] as const,
				(payload: unknown, noop: unknown, currentPhase: unknown, operationId: unknown, publicationRequested: unknown) => {
					const value = payload as Record<string, unknown> | null;
					const nextPhase = phaseOf(value?.phase);
					const current = phaseOf(currentPhase);
					if (publicationRequested && nextPhase === "completed") return noop;
					if (!value || value.operationId !== operationId || !current || !nextPhase || !TRANSITIONS[current].has(nextPhase)) return noop;
					return {
						phase: nextPhase,
						reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : null,
						errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
						updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null,
						interrupted: nextPhase === "interrupted",
						outcome: TERMINAL_PHASES.has(nextPhase) ? nextPhase : null,
					};
				},
			],
		},
		supersedeForAttempt: {
			to: { phase: ["phase"], interrupted: ["interrupted"], outcome: ["outcome"], updatedAt: ["updatedAt"] },
			fn: [
				["$noop", "bootId", "recoveryKind", "phase"] as const,
				(payload: unknown, noop: unknown, bootId: unknown, recoveryKind: unknown, phase: unknown) => {
					const value = payload as Record<string, unknown> | null;
					if (!value || (value.bootId === bootId && value.recoveryKind === recoveryKind)) return noop;
					const oldPhase = phaseOf(phase);
					const nextPhase = oldPhase === "awaiting-user-action" || oldPhase === "completed" ? "superseded" : "interrupted";
					return { phase: nextPhase, interrupted: nextPhase === "interrupted", outcome: nextPhase, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null };
				},
			],
		},
		recordPublicationDecision: {
			to: { publicationReceipt: ["publicationReceipt"], stagedAssetRef: ["stagedAssetRef"], stagedHandleRef: ["stagedHandleRef"] },
			fn: [["publicationState", "< @one:_node_id < resource", "< @one:_node_id < resource.project", "< @one:localAcceptedPublication < resource"] as const,
				(payload: unknown, rawState: unknown, resourceId: unknown, projectId: unknown, resourceReceipt: unknown) => {
					const state = recordOf(rawState); const decision = acceptedPublication(payload);
					if (!state || !decision || !samePublicationValue(decision, resourceReceipt) || decision.kind !== "accepted" || !samePublicationCandidate(decision, { ...state, resourceId, projectId }) || !state.publicationRequested || state.removed || state.phase !== "committing" || state.publicationReceipt && !samePublicationValue(state.publicationReceipt, decision)) throw new Error("Media publication receipt guard rejected; abort pointer transaction");
					const receipt = decision;
					return { publicationReceipt: receipt, stagedAssetRef: receipt.pointer.assetRef, stagedHandleRef: receipt.pointer.sourceKind === "file-handle" ? receipt.pointer.sourceRef : null };
				}],
		},
		recordPublicationBindingResult: {
			to: { phase: ["phase"], outcome: ["outcome"], publicationBindingResult: ["publicationBindingResult"], updatedAt: ["updatedAt"], stagedAssetRef: ["stagedAssetRef"], stagedHandleRef: ["stagedHandleRef"] },
			fn: [["$noop", "publicationState", "< @one:localPublicationValidity < resource", "< @one:_node_id < resource.activeMediaRecoveryTask"] as const,
				(payload: unknown, noop: unknown, rawState: unknown, rawValidity: unknown, activeTaskId: unknown) => {
					const state = recordOf(rawState); const result = recordOf(payload); const validity = recordOf(rawValidity); const receipt = state?.publicationReceipt as AcceptedPublication | null;
					if (!state || !result || !receipt || !samePublicationTuple(receipt, result) || result.sequence !== receipt.sequence || result.candidateFingerprint !== receipt.candidateFingerprint || result.candidateFingerprintVersion !== receipt.candidateFingerprintVersion || typeof result.boundaryUpdatedAt !== "number" || !Number.isFinite(result.boundaryUpdatedAt) || !["installed", "obsolete", "indeterminate", "rejected"].includes(String(result.outcome))) return noop;
					const installed = result.outcome === "installed" && !state.removed && activeTaskId === state.taskId && validity?.eligible === true && samePublicationValue(validity.accepted, receipt) && (state.phase === "committing" || state.phase === "completed");
					if (result.outcome === "installed" && !installed) return noop;
					return { phase: installed ? "completed" : state.phase, outcome: installed ? "completed" : state.outcome ?? null, publicationBindingResult: result, updatedAt: typeof result.boundaryUpdatedAt === "number" ? result.boundaryUpdatedAt : null, stagedAssetRef: installed ? null : state.stagedAssetRef, stagedHandleRef: installed ? null : state.stagedHandleRef };
				}],
		},
		completePublication: [
			{ to: { forwarded: ["$output"] }, fn: [["publicationState", "< @one:localPublicationValidity < resource", "< @one:_node_id < resource", "< @one:_node_id < resource.project"] as const,
				(payload: unknown, rawState: unknown, rawValidity: unknown, resourceId: unknown, projectId: unknown) => {
					const state = recordOf(rawState); const proposal = publicationProposal(payload); const validity = recordOf(rawValidity);
					if (!state || !proposal) return { forwarded: {} };
					if (state.publicationReceipt && !samePublicationCandidate(proposal, state.publicationReceipt)) return { forwarded: {} };
					if (!state.publicationReceipt && !samePublicationCandidate(proposal, { ...state, resourceId, projectId })) return { forwarded: {} };
					if (state.publicationReceipt) return { forwarded: { replay: { decision: state.publicationReceipt, bindingEligibility: validity?.eligible === true && samePublicationValue(validity.accepted, state.publicationReceipt) ? "current" : "obsolete" } } };
					return state.publicationRequested && state.phase === "committing" ? { forwarded: { proposal } } : { forwarded: {} };
				}] },
			{ when: [[] as const, (payload: unknown) => Boolean(recordOf(payload)?.replay)], to: ["$fx_mediaPublicationDecision", { intent: "call", drop_when_api_not_ready: false }], fn: (payload: unknown) => recordOf(payload)?.replay },
			{ when: [[] as const, (payload: unknown) => Boolean(recordOf(payload)?.proposal)], to: ["<< resource", { action: "completeMediaRecovery", sub_flow: true }], fn: (payload: unknown) => recordOf(payload)?.proposal },
		],
	},
	effects: {
		api: {
			mediaRecoveryRuntime: [
				["_node_id"] as const,
				["#mediaRecoveryRuntime"] as const,
				(runtime: unknown) => runtime,
			],
		},
		out: {
			$fx_mediaPublicationDecision: {
				create_when: { api_inits: false },
				api: ["mediaRecoveryRuntime"], fn: (api: unknown, state: unknown) => { (api as { publishMediaPublicationDecision(payload: unknown): void }).publishMediaPublicationDecision(recordOf(state)?.payload); },
			},
			$fx_mediaRecovery: {
				api: ["mediaRecoveryRuntime"],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as { requestMediaRecovery?: (payload: unknown) => void } | null;
					const payload = (state as { payload?: unknown } | null)?.payload;
					if (runtime?.requestMediaRecovery && payload && typeof payload === "object") runtime.requestMediaRecovery(payload);
				},
			},
			$fx_mediaRecoveryCommit: {
				api: ["mediaRecoveryRuntime"],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as { requestMediaRecovery?: (payload: unknown) => void } | null;
					const payload = (state as { payload?: unknown } | null)?.payload;
					if (runtime?.requestMediaRecovery && payload && typeof payload === "object") runtime.requestMediaRecovery(payload);
				},
			},
		},
	},
});
