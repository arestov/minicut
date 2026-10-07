import type { NodeAssetRegistry } from "../../adapters/node/nodeAssetRegistry";
import type { ProbeResult } from "../../media/contracts/probe";
import {
	evaluateRelinkCandidate,
	type MediaTechnicalMetadata,
} from "../../media/mediaRelinkPolicy";
import { assetUriFor } from "./assetUri";
import { localAssetIdOf } from "./localAssetSource";
import {
	classifyProbe,
	technicalMetadataFromProbe,
} from "./hostMedia";
import { type HostPage, type RuntimeRefs, scopeFor } from "./hostTypes";

/**
 * Node mapping of the media recovery facts (M3): the model keeps the Web
 * vocabulary, this host reports a reachable local file as
 * `ready-file-handle` + `granted` and a missing one as `unavailable` +
 * `missing`, which the model turns into the `source-missing` reason. The user
 * then picks the file again in the native dialog (locate / replace).
 */
export const NODE_AVAILABLE = {
	availability: "ready-file-handle",
	originalAccess: "granted",
} as const;
export const NODE_MISSING = {
	availability: "unavailable",
	originalAccess: "missing",
} as const;

export type MediaRecoveryExecutorDeps = {
	page: HostPage;
	registry: Pick<NodeAssetRegistry, "resolve" | "register" | "relink" | "get">;
	refs: RuntimeRefs;
	probe(filePath: string): Promise<ProbeResult>;
	fingerprint(
		filePath: string,
	): Promise<{ fingerprint: string; version: string }>;
	/** Called after a recovery changed which file an asset points to. */
	onAssetsChanged(): void;
	/** Resource `url` of a registered asset (a host-local attr); defaults to the registry reference. */
	assetUrl?(assetId: string): string;
	generateId(): string;
	now(): number;
};

export type MediaRecoveryExecutor = {
	/** Handler of the `$fx_mediaRecovery` task request published by the host. */
	handleRequest(payload: unknown): Promise<void>;
	/**
	 * Starts a user relink of one resource from a picked file: the path stays in
	 * the process-local ref store, the model gets `startMediaRecovery` with its
	 * `runtimeHandleId`.
	 */
	requestRelink(
		resourceId: string,
		filePath: string,
		intent: "locate-original" | "replace-source",
	): void;
};

type RecoveryRequest = {
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
	sourceKind?: unknown;
	sourceRef?: unknown;
};

type CommitRequest = {
	taskId: string;
	resourceId: string;
	operationId: string;
	runtimeHandleId?: string | null;
	candidateMetadata?: Record<string, unknown> | null;
	candidateFingerprint?: string | null;
	candidateFingerprintVersion?: string | null;
	sourceKind?: unknown;
	sourceRef?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseRequest = (value: unknown): RecoveryRequest | null =>
	isObject(value) &&
	typeof value.taskId === "string" &&
	typeof value.resourceId === "string" &&
	typeof value.operationId === "string" &&
	typeof value.bootId === "string" &&
	typeof value.intent === "string" &&
	isObject(value.original) &&
	typeof value.requiredSourceEnd === "number"
		? (value as unknown as RecoveryRequest)
		: null;

const EXACT_MATCH = {
	classification: "exact-match",
	reasons: [],
	requiresConfirmation: false,
	diff: {},
	durationTolerance: 0,
} as const;

/**
 * Media recovery executor. Every outcome is its own dispatch of an existing
 * model action (same delivery as web page executors): `recordInspection`,
 * `requestCommit`, `completePublication`, `transition` on the task scope and
 * `recordAutomaticMediaRecovery` on the resource scope. Nothing here keeps
 * state of its own besides the process-local runtime refs.
 */
export const createMediaRecoveryExecutor = (
	deps: MediaRecoveryExecutorDeps,
): MediaRecoveryExecutor => {
	const { page, refs, registry } = deps;
	const committing = new Set<string>();

	const failTask = (
		request: { taskId: string; operationId: string },
		reasonCode: string,
		errorMessage: string,
	): void => {
		page.dispatch(
			"transition",
			{
				operationId: request.operationId,
				phase: "failed",
				reasonCode,
				errorMessage,
				updatedAt: deps.now(),
			},
			scopeFor(request.taskId),
		);
	};

	const inspectedExact = (
		request: RecoveryRequest,
		candidateMetadata: unknown,
	): void => {
		const task = scopeFor(request.taskId);
		page.dispatch(
			"recordInspection",
			{
				operationId: request.operationId,
				classification: "exact-match",
				confirmationRequired: false,
				compatibility: EXACT_MATCH,
				candidateMetadata,
				candidateFingerprint: request.originalFingerprint ?? null,
				candidateFingerprintVersion: request.fingerprintVersion ?? null,
				updatedAt: deps.now(),
			},
			task,
		);
		page.dispatch(
			"requestCommit",
			{ operationId: request.operationId, updatedAt: deps.now() },
			task,
		);
	};

	const markMissing = (request: RecoveryRequest): void => {
		page.dispatch(
			"recordAutomaticMediaRecovery",
			{ ...NODE_MISSING, updatedAt: deps.now() },
			scopeFor(request.resourceId),
		);
	};

	/** Restore (boot) and import: the asset is already registered; check the file. */
	const restore = async (
		request: RecoveryRequest,
		assetId: string | null,
	): Promise<void> => {
		const resolution = assetId ? await registry.resolve(assetId) : null;
		if (!resolution?.ok) {
			markMissing(request);
			return;
		}
		inspectedExact(request, request.original);
	};

	/** Locate/replace from a picked file: probe, compare with the original, record the verdict. */
	const inspectCandidate = async (
		request: RecoveryRequest,
		candidatePath: string,
	): Promise<void> => {
		try {
			const info = await deps.probe(candidatePath);
			const kind = classifyProbe(info);
			if (!kind) {
				failTask(request, "inspection-failed", "The selected file is not media.");
				return;
			}
			const candidate = technicalMetadataFromProbe(info, kind);
			let fingerprint: { fingerprint: string; version: string } | null = null;
			try {
				fingerprint = await deps.fingerprint(candidatePath);
			} catch {
				// Unknown identity is explicit and never promoted to exact.
			}
			const identity =
				fingerprint && request.originalFingerprint
					? fingerprint.version === request.fingerprintVersion &&
						fingerprint.fingerprint === request.originalFingerprint
						? "fingerprint-match"
						: "mismatch"
					: "metadata-only";
			const policy = evaluateRelinkCandidate({
				intent:
					request.intent === "locate-original"
						? "locate-original"
						: "replace-source",
				original: request.original,
				candidate,
				requiredSourceEnd: request.requiredSourceEnd,
				identity,
			});
			const task = scopeFor(request.taskId);
			page.dispatch(
				"recordInspection",
				{
					operationId: request.operationId,
					classification: policy.classification,
					confirmationRequired: policy.requiresConfirmation,
					compatibility: policy,
					reasonCode: policy.reasons[0] ?? null,
					candidateMetadata: candidate,
					candidateFingerprint: fingerprint?.fingerprint ?? null,
					candidateFingerprintVersion: fingerprint?.version ?? null,
					updatedAt: deps.now(),
				},
				task,
			);
			if (policy.classification === "exact-match") {
				page.dispatch(
					"requestCommit",
					{ operationId: request.operationId, updatedAt: deps.now() },
					task,
				);
			}
		} catch (error) {
			failTask(
				request,
				"inspection-failed",
				error instanceof Error ? error.message : "Unable to inspect the selected file.",
			);
		}
	};

	const commit = async (request: CommitRequest): Promise<void> => {
		if (committing.has(request.operationId)) return;
		committing.add(request.operationId);
		try {
			const ref =
				typeof request.runtimeHandleId === "string"
					? (refs.get(request.runtimeHandleId) as {
							assetId?: string;
							path?: string;
						} | null)
					: null;
			let assetId = ref?.assetId ?? localAssetIdOf(request);
			if (typeof ref?.path === "string") {
				// Relink: the asset id stays, it now points at the picked file.
				assetId = assetId
					? (await registry.relink(assetId, ref.path)).assetId
					: (await registry.register(ref.path)).assetId;
				deps.onAssetsChanged();
			}
			const resolution = assetId ? await registry.resolve(assetId) : null;
			if (!assetId || !resolution?.ok) {
				failTask(request, "source-missing", "The source file is not available.");
				return;
			}
			const metadata = request.candidateMetadata ?? null;
			await page.dispatchAndWait(
				"completePublication",
				{
					operationId: request.operationId,
					assetStorageKind: "linked",
					assetRef: null,
					// `local-asset`: file registered in the host asset registry (M2).
					sourceKind: "local-asset",
					sourceRef: assetId,
					url: (deps.assetUrl ?? assetUriFor)(assetId),
					contentFingerprint: request.candidateFingerprint ?? null,
					fingerprintVersion: request.candidateFingerprintVersion ?? null,
					...(typeof metadata?.duration === "number" ? { duration: metadata.duration } : {}),
					...(typeof metadata?.width === "number" ? { width: metadata.width } : {}),
					...(typeof metadata?.height === "number" ? { height: metadata.height } : {}),
					localMediaAvailability: NODE_AVAILABLE.availability,
					originalAccessStatus: NODE_AVAILABLE.originalAccess,
					updatedAt: deps.now(),
				},
				scopeFor(request.taskId),
			);
			if (typeof request.runtimeHandleId === "string") {
				refs.delete(request.runtimeHandleId);
			}
		} catch (error) {
			failTask(
				request,
				"commit-failed",
				error instanceof Error ? error.message : "Could not save the selected source.",
			);
		}
	};

	return {
		async handleRequest(payload) {
			if (isObject(payload) && payload.mode === "commit") {
				if (
					typeof payload.taskId === "string" &&
					typeof payload.resourceId === "string" &&
					typeof payload.operationId === "string"
				) {
					await commit(payload as unknown as CommitRequest);
				}
				return;
			}
			const request = parseRequest(payload);
			if (!request) return;
			if (request.intent === "restore") {
				const ref =
					typeof request.runtimeHandleId === "string"
						? (refs.get(request.runtimeHandleId) as { assetId?: string } | null)
						: null;
				await restore(request, ref?.assetId ?? localAssetIdOf(request));
				return;
			}
			const picked =
				typeof request.runtimeHandleId === "string"
					? (refs.get(request.runtimeHandleId) as { path?: string } | null)
					: null;
			if (!picked?.path) {
				// Nothing chosen yet: the user acts (locate / replace) from the resource.
				page.dispatch(
					"transition",
					{
						operationId: request.operationId,
						phase: "awaiting-user-action",
						reasonCode: "user-action-required",
						errorMessage: null,
						updatedAt: deps.now(),
					},
					scopeFor(request.taskId),
				);
				return;
			}
			await inspectCandidate(request, picked.path);
		},

		requestRelink(resourceId, filePath, intent) {
			const now = deps.now();
			page.dispatch(
				"startMediaRecovery",
				{
					operationId: `user:${deps.generateId()}`,
					attemptId: deps.generateId(),
					bootId: `user:${deps.generateId()}`,
					recoveryKind: intent,
					intent,
					runtimeHandleId: refs.put({ path: filePath }),
					createdAt: now,
					updatedAt: now,
				},
				scopeFor(resourceId),
			);
		},
	};
};
