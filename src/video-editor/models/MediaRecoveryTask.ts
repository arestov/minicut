import { model } from "dkt/model.js";

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
					["$noop", "_node_id", "operationId", "bootId", "intent", "< @one:_node_id < resource", "< @one:kind < resource", "< @one:duration < resource", "< @one:width < resource", "< @one:height < resource", "< @one:contentFingerprint < resource", "< @one:fingerprintVersion < resource", "< @one:requiredSourceEnd < resource"] as const,
					(payload: unknown, noop: unknown, taskId: unknown, operationId: unknown, bootId: unknown, intent: unknown, resourceId: unknown, kind: unknown, duration: unknown, width: unknown, height: unknown, contentFingerprint: unknown, fingerprintVersion: unknown, requiredSourceEnd: unknown) => {
						const value = payload as Record<string, unknown> | null;
						if (!value || typeof taskId !== "string" || typeof resourceId !== "string") return noop;
						return { taskId, resourceId, operationId, bootId, intent, runtimeHandleId: value.runtimeHandleId, original: { kind, duration, width, height }, originalFingerprint: contentFingerprint, fingerprintVersion, requiredSourceEnd };
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
					const classification = value.classification;
					const nextPhase = classification === "incompatible" ? "rejected" : value.confirmationRequired === true ? "awaiting-confirmation" : "ready-to-commit";
					return { phase: nextPhase, candidateMetadata: value.candidateMetadata ?? null, candidateFingerprint: value.candidateFingerprint ?? null, candidateFingerprintVersion: value.candidateFingerprintVersion ?? null, compatibility: value.compatibility ?? null, reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : null, errorMessage: null, confirmationRequired: value.confirmationRequired === true, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null };
				},
			],
		},
		recordRestoreState: {
			to: { phase: ["phase"], reasonCode: ["reasonCode"], errorMessage: ["errorMessage"], updatedAt: ["updatedAt"], outcome: ["outcome"] },
			fn: [["$noop", "phase"] as const, (payload: unknown, noop: unknown, phase: unknown) => {
				const value = payload as { availability?: unknown; originalAccess?: unknown; updatedAt?: unknown } | null;
				if (!value || phase === "completed" || phase === "superseded" || phase === "interrupted") return noop;
				const ready = value.availability === "ready-project-copy" || value.availability === "ready-file-handle";
				return { phase: ready ? "completed" : "awaiting-user-action", reasonCode: ready ? null : value.originalAccess === "denied" ? "permission-denied" : value.originalAccess === "prompt" ? "permission-required" : "source-missing", errorMessage: null, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null, outcome: ready ? "completed" : null };
			}],
		},
		requestCommit: [
			{
				to: { phase: ["phase"], forwarded: ["$output"] },
				fn: [
					["$noop", "operationId", "phase"] as const,
					(payload: unknown, noop: unknown, operationId: unknown, phase: unknown) => {
						const value = payload as Record<string, unknown> | null;
						return value?.operationId === operationId && (phase === "ready-to-commit" || phase === "awaiting-confirmation") ? { phase: "committing", forwarded: value } : noop;
					},
				],
			},
			{
				to: ["$fx_mediaRecoveryCommit", { intent: "call", drop_when_api_not_ready: false }],
				fn: [
					["$noop", "_node_id", "operationId", "runtimeHandleId", "candidateMetadata", "candidateFingerprint", "candidateFingerprintVersion", "< @one:_node_id < resource", "< @one:kind < resource", "< @one:duration < resource", "< @one:width < resource", "< @one:height < resource"] as const,
					(_payload: unknown, noop: unknown, taskId: unknown, operationId: unknown, runtimeHandleId: unknown, candidateMetadata: unknown, candidateFingerprint: unknown, candidateFingerprintVersion: unknown, resourceId: unknown, kind: unknown, duration: unknown, width: unknown, height: unknown) => typeof taskId === "string" && typeof resourceId === "string" ? { mode: "commit", taskId, resourceId, operationId, runtimeHandleId, candidateMetadata: candidateMetadata ?? { kind, duration, width, height }, candidateFingerprint, candidateFingerprintVersion } : noop,
				],
			},
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
				["$noop", "phase", "operationId"] as const,
				(payload: unknown, noop: unknown, currentPhase: unknown, operationId: unknown) => {
					const value = payload as Record<string, unknown> | null;
					const nextPhase = phaseOf(value?.phase);
					const current = phaseOf(currentPhase);
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
		completePublication: {
			to: { phase: ["phase"], outcome: ["outcome"], updatedAt: ["updatedAt"], stagedAssetRef: ["stagedAssetRef"], stagedHandleRef: ["stagedHandleRef"] },
			fn: [
				["$noop", "operationId", "phase"] as const,
				(payload: unknown, noop: unknown, operationId: unknown, phase: unknown) => {
					const value = payload as Record<string, unknown> | null;
					if (!value || value.operationId !== operationId || phase !== "committing") return noop;
					return { phase: "completed", outcome: "completed", updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : null, stagedAssetRef: null, stagedHandleRef: null };
				},
			],
		},
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
