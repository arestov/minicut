import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";
import { evaluateRelinkCandidate, type MediaTechnicalMetadata, type RelinkPolicyResult } from "../media/mediaRelinkPolicy";
import type { PermissionFileHandle } from "../media/localMediaResolver";

export type MediaRecoveryRuntimeCandidate = {
	file: File;
	handle?: PermissionFileHandle | null;
};

export type MediaRecoveryEffectRequest = {
	taskId: string;
	resourceId: string;
	operationId: string;
	bootId: string;
	intent: "restore" | "grant-access" | "locate-original" | "replace-source";
	runtimeHandleId?: string;
	original: MediaTechnicalMetadata;
	originalFingerprint?: string | null;
	fingerprintVersion?: string | null;
	requiredSourceEnd: number;
};

export type MediaRecoveryInspectionOutcome = {
	operationId: string;
	policy: RelinkPolicyResult;
	candidate: MediaTechnicalMetadata;
	fingerprint: string | null;
	fingerprintVersion: string | null;
};

const scope = (nodeId: string): ReactSyncScopeHandle => ({ kind: "scope", _nodeId: nodeId });

const parseRequest = (value: unknown): MediaRecoveryEffectRequest | null => {
	const request = value as Partial<MediaRecoveryEffectRequest> | null;
	return request && typeof request.taskId === "string" && typeof request.resourceId === "string" && typeof request.operationId === "string" && typeof request.bootId === "string" && typeof request.intent === "string" && request.original && typeof request.original === "object" && typeof request.requiredSourceEnd === "number"
		? (request as MediaRecoveryEffectRequest)
		: null;
};

export const executeMediaRecoveryInspectionTask = async ({
	request: rawRequest,
	consumeRuntimeRef,
	probe,
	fingerprint,
	dispatch,
	now,
	isCancelled = () => false,
}: {
	request: unknown;
	consumeRuntimeRef(runtimeHandleId: string): unknown;
	probe(file: File, signal?: AbortSignal): Promise<MediaTechnicalMetadata>;
	fingerprint(file: File, signal?: AbortSignal): Promise<{ fingerprint: string; version: string }>;
	dispatch(actionName: string, payload: unknown, target: ReactSyncScopeHandle): void;
	now(): number;
	isCancelled?(operationId: string): boolean;
}): Promise<MediaRecoveryInspectionOutcome | null> => {
	const request = parseRequest(rawRequest);
	if (!request) return null;
	const fail = (reasonCode: string, errorMessage: string) => {
		dispatch("transition", { operationId: request.operationId, phase: "failed", reasonCode, errorMessage, updatedAt: now() }, scope(request.taskId));
	};
	if (!request.runtimeHandleId) {
		fail("runtime-ref-missing", "The selected file is no longer available. Choose it again.");
		return null;
	}
	const runtimeValue = consumeRuntimeRef(request.runtimeHandleId) as Partial<MediaRecoveryRuntimeCandidate> | null;
	if (!(runtimeValue?.file instanceof File)) {
		fail("runtime-ref-expired", "The selected file is no longer available. Choose it again.");
		return null;
	}
	try {
		const candidate = await probe(runtimeValue.file);
		if (isCancelled(request.operationId)) return null;
		let identityFingerprint: string | null = null;
		let identityVersion: string | null = null;
		try {
			const result = await fingerprint(runtimeValue.file);
			identityFingerprint = result.fingerprint;
			identityVersion = result.version;
		} catch {
			// Unknown identity is represented explicitly and never promoted to exact.
		}
		if (isCancelled(request.operationId)) return null;
		const identity = identityFingerprint && request.originalFingerprint
			? identityVersion === request.fingerprintVersion && identityFingerprint === request.originalFingerprint
				? "fingerprint-match"
				: "mismatch"
			: "metadata-only";
		let policy = evaluateRelinkCandidate({ original: request.original, candidate, requiredSourceEnd: request.requiredSourceEnd, identity });
		if (request.intent === "locate-original" && policy.classification !== "exact-match") {
			policy = { ...policy, classification: "incompatible", requiresConfirmation: false };
		}
		const outcome = { operationId: request.operationId, policy, candidate, fingerprint: identityFingerprint, fingerprintVersion: identityVersion };
		dispatch("recordInspection", {
			operationId: request.operationId,
			classification: policy.classification,
			confirmationRequired: policy.requiresConfirmation,
			compatibility: policy,
			reasonCode: policy.reasons[0] ?? null,
			candidateMetadata: candidate,
			candidateFingerprint: identityFingerprint,
			candidateFingerprintVersion: identityVersion,
			updatedAt: now(),
		}, scope(request.taskId));
		return outcome;
	} catch (error) {
		if (!isCancelled(request.operationId)) fail("inspection-failed", error instanceof Error ? error.message : "Unable to inspect selected media.");
		return null;
	}
};
