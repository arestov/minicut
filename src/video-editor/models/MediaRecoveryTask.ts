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
});
