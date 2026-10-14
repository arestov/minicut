import { addr as diagnosticAddr } from "dkt/dcl/addr.js";
import { queryRel as queryNativeRel } from "dkt/async/queryRel.js";
import { queryAttr as queryNativeAttr, queryManyAttrs as queryNativeManyAttrs } from "dkt/async/queryAttr.js";
import { queryAddr as queryNativeAddr } from "dkt/async/queryAddr.js";
import { getModelById } from "dkt/getModelById.js";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";
import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { createEffectContractFakes } from "../test/effectContractFakes";
import { model } from "dkt/model.js";
import { appRoot } from "dkt/appRoot.js";
import { MiniCutAppRoot as productionMiniCutAppRoot, type MiniCutAppRoot } from "../../models/AppRoot";
import { MINICUT_APP_PROPS, MINICUT_APP_MODELS } from "../../models/AppRootDeclaration";
import { merge as mergeDcl } from "dkt/dcl/merge.js";
import { Project, PROJECT_IMPORT_RESOURCE_STEPS, PROJECT_CRDT_REL_POLICIES } from "../../models/Project";
import { reduceSetResources } from "../../models/Project/actions";
import { acceptedPublication, capturedPublicationRetirements, copyPublicationValue, publicationIdentity, publicationProposal, publicationTuple, recordOf, samePublicationCandidate, type AcceptedPublication, type PublicationManifest } from "../../media/mediaPublicationProtocol";
import { describe, expect, it } from "vitest";
import { createLocalMediaResolver, type LocalMediaResourceSnapshot } from "../../media/localMediaResolver";
import { createMediaPublicationConsumer } from "../../media/mediaPublicationConsumer";
import { MediaRecoveryTask } from "../../models/MediaRecoveryTask";
import { Resource } from "../../models/Resource";
import { createActionContractHarness as createBaseActionContractHarness, dispatchAndSettle } from "./action-contract-test-harness";
import { bootDktModels, getAttr, queryAttr, queryRel } from "../testingInit";

type MembershipFrames = {
	firstMembers: readonly unknown[];
	secondMembers?: readonly unknown[];
	finalMembers?: readonly unknown[];
};
const ProjectTest = model({
	extends: Project,
	rels: {
		testTransientBaselineResources: ["input", { linking: "<< resource << #", many: true, role: "projection" }],
	},
	crdt: { rels: { ...PROJECT_CRDT_REL_POLICIES, testTransientBaselineResources: { sync: false, reason: "projection" } } },
	actions: {
		transientCandidate: [
			{
				to: { baseline: ["<< testTransientBaselineResources", { method: "set_many" }], forwarded: ["$output"] },
				fn: [["<< @all:resources"], (payload: unknown, resources: readonly unknown[]) => ({ baseline: resources, forwarded: payload })],
			},
			...PROJECT_IMPORT_RESOURCE_STEPS,
			{
				to: { resources: ["<< resources", { method: "set_many" }] },
				fn: [["<< @all:testTransientBaselineResources"], (_payload: unknown, baseline: readonly unknown[]) => reduceSetResources({ resources: baseline })],
			},
		] as const,
	},
});
const testProps = mergeDcl({
	...MINICUT_APP_PROPS,
	models: MINICUT_APP_MODELS.map((Model) => Model === Project ? ProjectTest : Model),
	rels: {
		...MINICUT_APP_PROPS.rels,
		project: ["input", { linking: ProjectTest, many: true, role: "owner", ownership: "slot-single", inverseRel: "rootOwner" }],
		testApiInitProject: ["input", { linking: "project", role: "projection" }],
		testApiInitResources: ["input", { linking: "resource", many: true, role: "projection" }],
	},
	attrs: { ...MINICUT_APP_PROPS.attrs, testApiInitArmed: ["input", false] },
	crdt: {
		...MINICUT_APP_PROPS.crdt,
		attrs: { ...MINICUT_APP_PROPS.crdt.attrs, testApiInitArmed: { sync: false, reason: "projection" } },
		rels: {
			...MINICUT_APP_PROPS.crdt.rels,
			testApiInitProject: { sync: false, reason: "projection" },
			testApiInitResources: { sync: false, reason: "projection" },
		},
	},
	actions: {
		...MINICUT_APP_PROPS.actions,
		removePublished: [
			{
				input_base_rel_shape: { project: { linking: "<< project", many: false } },
				output_base_rel_shape: { project: { linking: "<< project", many: false } },
				to: { work: ["<<<< $input:project", { action: "setResources", sub_flow: true }], forwarded: ["$output"] },
				fn: (payload: MembershipFrames) => ({ work: { resources: payload.firstMembers }, forwarded: payload }),
			},
			{ input_base_rel_shape: { project: { linking: "<< project", many: false } }, to: ["<<<< $input:project", { action: "setResources", sub_flow: true }], fn: (payload: MembershipFrames) => ({ resources: payload.secondMembers }) },
		],
		unlinkRelink: [
			{
				input_base_rel_shape: { project: { linking: "<< project", many: false } },
				output_base_rel_shape: { project: { linking: "<< project", many: false } },
				to: { work: ["<<<< $input:project", { action: "setResources", sub_flow: true }], forwarded: ["$output"] },
				fn: (payload: MembershipFrames) => ({ work: { resources: payload.firstMembers }, forwarded: payload }),
			},
			{ input_base_rel_shape: { project: { linking: "<< project", many: false } }, to: ["<<<< $input:project", { action: "setResources", sub_flow: true }], fn: (payload: MembershipFrames) => ({ resources: payload.finalMembers }) },
		],
		"handleAttr:$meta$apis$mediaRecoveryRuntime$used": [
			{
				when: [["testApiInitArmed"], (payload: { prev_value?: unknown; next_value?: unknown }, armed: boolean) => armed === true && payload.prev_value === false && typeof payload.next_value === "number"],
				output_base_rel_shape: { project: { linking: "<< project", many: false } },
				to: { forwarded: ["$output"] },
				fn: [["<< @one:testApiInitProject"], (payload: unknown, project: unknown) => ({ forwarded: { ...(payload as object), project } })],
			},
			{
				when: [["testApiInitArmed"], (payload: { project?: unknown } | null, armed: boolean) => armed === true && Boolean(payload?.project)],
				input_base_rel_shape: { project: { linking: "<< project", many: false } },
				to: ["<<<< $input:project", { action: "setResources", sub_flow: true }],
				fn: [["<< @all:testApiInitResources"], (_payload: unknown, resources: readonly unknown[]) => ({ resources })],
			},
		],
		unlinkProjects: { to: { projects: ["<< project", { method: "set_many" }] }, fn: (payload: { projects: readonly unknown[] }) => ({ projects: payload.projects }) },
		physicalDeletePublished: [
			{
				input_base_rel_shape: { resource: { linking: "<< resource", many: false } },
				output_base_rel_shape: { project: { linking: "<< project", many: false } },
				to: { work: ["<<<< $input:resource", { action: "removeSelf", sub_flow: true }], forwarded: ["$output"] },
				fn: (payload: unknown) => ({ work: payload, forwarded: payload }),
			},
			{ input_base_rel_shape: { project: { linking: "<< project", many: false } }, to: ["<<<< $input:project", { action: "setResources", sub_flow: true }], fn: (payload: { membersAfterDelete: readonly unknown[] }) => ({ resources: payload.membersAfterDelete }) },
		],
		armApiInitUnlink: {
			to: { project: ["<< testApiInitProject", { method: "set_one" }], resources: ["<< testApiInitResources", { method: "set_many" }], armed: ["testApiInitArmed"] },
			fn: (payload: { project: unknown; resources: readonly unknown[] }) => ({ project: payload.project, resources: payload.resources, armed: true }),
		},
	},
});
const MediaContractTestRoot = appRoot(testProps, testProps.init) as typeof MiniCutAppRoot;
const createActionContractHarness = (options: Omit<NonNullable<Parameters<typeof createBaseActionContractHarness>[0]>, "App"> = {}) =>
	createBaseActionContractHarness({ ...options, App: MediaContractTestRoot });

const encodePublicationDiagnostic = (value: unknown): unknown => {
	if (value === undefined) return { diagnosticUndefined: true };
	if (Array.isArray(value)) return value.map(encodePublicationDiagnostic);
	if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodePublicationDiagnostic(entry)]));
	}
	return value;
};
const logPublicationDiagnostic = (boundary: string, values: unknown) => {
	console.info("MEDIA_PUBLICATION_DIAGNOSTIC " + boundary + " " + JSON.stringify(encodePublicationDiagnostic(values)));
};
const attempt = (bootId: string, operationId: string) => ({
	bootId,
	operationId,
	attemptId: `${operationId}:attempt`,
	recoveryKind: "restore",
	intent: "restore",
	createdAt: 100,
	updatedAt: 100,
});

describe("owned MediaRecoveryTask action contracts", () => {
	it("creates an imported Resource and exactly one owned task in the same flow", async () => {
		const requests: unknown[] = [];
		const harness = await createActionContractHarness({ interfaces: { mediaRecoveryRuntime: { requestMediaRecovery: (payload: unknown) => requests.push(payload) } } });
		expect(harness.publicationDecisions).toEqual([]);
		const before = await queryRel(harness.project, "resources");
		await dispatchAndSettle(harness.ctx, harness.project, "importResource", {
			name: "import.webm", kind: "video", url: "blob:import", mime: "video/webm", duration: 4, size: 10, status: "ready",
			operationId: "operation:import", attemptId: "attempt:import", bootId: "boot:import", recoveryKind: "import", intent: "restore", runtimeHandleId: "runtime:import",
			original: { kind: "video", duration: 4, streams: { videoStreams: 1, audioStreams: null } }, requiredSourceEnd: 4, createdAt: 1, updatedAt: 1,
		});
		const after = await queryRel(harness.project, "resources"); const imported = after.find((resource) => !before.some((old) => old._node_id === resource._node_id));
		expect(imported).toBeTruthy();
		expect(await queryRel(imported!, "mediaRecoveryTasks")).toHaveLength(1);
		expect(await queryRel(imported!, "activeMediaRecoveryTask")).toHaveLength(1);
		expect(requests).toHaveLength(1);
		expect(harness.publicationDecisions).toEqual([]);
	});

	it("routes serializable recovery work through the declared task effect", async () => {
		const requests: unknown[] = [];
		const harness = await createActionContractHarness({
			interfaces: {
				mediaRecoveryRuntime: {
					requestMediaRecovery: (payload: unknown) => requests.push(payload),
				},
			},
		});

		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", {
			...attempt("boot:fx", "operation:fx"),
			intent: "replace-source",
			runtimeHandleId: "rt_tmp_candidate",
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			operationId: "operation:fx",
			bootId: "boot:fx",
			intent: "replace-source",
			runtimeHandleId: "rt_tmp_candidate",
			resourceId: harness.videoResource._node_id,
			original: { kind: "video", duration: 10 },
		});
		expect(JSON.stringify(requests[0])).not.toContain("FileSystemFileHandle");
	});

	it("creates one active task per boot key and supersedes the old attempt", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", attempt("boot:1", "operation:1"));

		const firstRead = await queryRel(harness.videoResource, "activeMediaRecoveryTask");
		expect(firstRead).toHaveLength(1);
		const firstTask = firstRead[0]!;
		expect(await queryAttr(firstTask, "publicationOwnership")).toMatchObject({ projectId: harness.project._node_id, resourceId: harness.videoResource._node_id, taskId: firstTask._node_id, operationId: "operation:1", attemptId: "operation:1:attempt", bootId: "boot:1", runtimeHandleId: null, eligible: true });
		expect(getAttr(firstTask, "bootId")).toBe("boot:1");

		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", attempt("boot:1", "operation:duplicate"));

		const duplicateRead = await queryRel(harness.videoResource, "activeMediaRecoveryTask");
		expect(duplicateRead).toHaveLength(1);
		expect(duplicateRead[0]?._node_id).toBe(firstTask._node_id);
		expect(getAttr(duplicateRead[0], "operationId")).toBe("operation:1");

		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", attempt("boot:2", "operation:2"));

		const secondRead = await queryRel(harness.videoResource, "activeMediaRecoveryTask");
		expect(secondRead).toHaveLength(1);
		expect(secondRead[0]?._node_id).not.toBe(firstTask._node_id);
		expect(getAttr(secondRead[0], "bootId")).toBe("boot:2");
		expect(getAttr(firstTask, "phase")).toBe("interrupted");
	});

	it("records automatic availability on Resource and its active boot task", async () => {
		const harness = await createActionContractHarness();
		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", attempt("boot:auto", "operation:auto"));
		const task = (await queryRel(harness.videoResource, "activeMediaRecoveryTask"))[0]!;
		await dispatchAndSettle(harness.ctx, harness.videoResource, "recordAutomaticMediaRecovery", { availability: "ready-project-copy", originalAccess: "denied", updatedAt: 5 });
		expect(getAttr(harness.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
		expect(getAttr(harness.videoResource, "originalAccessStatus")).toBe("denied");
		expect(getAttr(task, "phase")).toBe("completed");
	});

	it("enforces transitions and atomically publishes only the current operation", async () => {
		const harness = await createActionContractHarness();
		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", attempt("boot:1", "operation:1"));
		const task = (await queryRel(harness.videoResource, "activeMediaRecoveryTask"))[0]!;
		await dispatchAndSettle(harness.ctx, task, "transition", { operationId: "operation:1", phase: "completed", updatedAt: 101 });
		expect(getAttr(task, "phase")).toBe("inspecting");
		const candidateMetadata = { kind: "video", duration: 10, width: 1920, height: 1080 };
		await dispatchAndSettle(harness.ctx, task, "recordInspection", { operationId: "operation:1", classification: "compatible-replacement", confirmationRequired: false, candidateMetadata, candidateFingerprint: "sha256:abc", candidateFingerprintVersion: "sha256-v1", updatedAt: 101 });
		await dispatchAndSettle(harness.ctx, task, "requestCommit", { operationId: "operation:1", updatedAt: 102 });
		const request = harness.mediaRecoveryRequests.at(-1) as Record<string, unknown>;
		const pointer = { assetStorageKind: "project-copy", assetRef: "project/p/resource/r/asset/operation:1", sourceKind: "file-handle", sourceRef: "handle:operation:1", url: "blob:operation:1", contentFingerprint: "sha256:abc", fingerprintVersion: "sha256-v1", duration: 10, width: 1920, height: 1080, localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted" };
		const proposal = { ...request, candidateFileMetadata: { mime: "video/webm", size: 1010, lastModified: 103 }, pointer, updatedAt: 103 };
		await dispatchAndSettle(harness.ctx, task, "completePublication", { ...proposal, operationId: "stale" });
		expect(getAttr(harness.videoResource, "assetRef")).not.toBe(pointer.assetRef);
		await harness.ctx.lockToRead(async () => {
			const [stateValue] = await queryNativeManyAttrs(task as never, ["publicationState"]);
			const state = stateValue as Record<string, unknown> | null | undefined;
			logPublicationDiagnostic("optional-tuple-before-final-publication", {
				taskRuntimeHandleId: state?.runtimeHandleId,
				taskHasRuntimeHandleId: Boolean(state && Object.hasOwn(state, "runtimeHandleId")),
				commitRequestRuntimeHandleId: request.runtimeHandleId,
				proposalRuntimeHandleId: proposal.runtimeHandleId,
			});
			expect(state?.runtimeHandleId).toBeNull();
			expect(request.runtimeHandleId).toBeNull();
			expect(proposal.runtimeHandleId).toBeNull();
		});
		await dispatchAndSettle(harness.ctx, task, "completePublication", proposal);
		expect(getAttr(harness.videoResource, "assetRef")).toBe(pointer.assetRef);
		expect(getAttr(harness.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
		expect(getAttr(task, "phase")).toBe("committing");
		const envelope = harness.publicationDecisions.at(-1) as { decision: Record<string, unknown>; bindingEligibility: string };
		expect(envelope.bindingEligibility).toBe("current");
		expect(getAttr(task, "publicationReceipt")).toEqual(envelope.decision);
		expect(getAttr(harness.videoResource, "localAcceptedPublication")).toEqual(envelope.decision);
		await dispatchAndSettle(harness.ctx, task, "recordPublicationBindingResult", { ...envelope.decision, outcome: "installed", boundaryUpdatedAt: 104 });
		expect(getAttr(task, "phase")).toBe("completed");
		expect(getAttr(task, "outcome")).toBe("completed");
	});

	it("does not complete publication before the host binding result", async () => {
		const requests: Record<string, unknown>[] = [];
		const harness = await createActionContractHarness({
			interfaces: {
				mediaRecoveryRuntime: {
					requestMediaRecovery: (payload: unknown) => requests.push(payload as Record<string, unknown>),
				},
			},
		});
		const recoveryAttempt = {
			...attempt("boot:binding", "operation:binding"),
			intent: "replace-source",
			runtimeHandleId: "runtime:binding",
		};
		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", recoveryAttempt);
		const activeTasks = await queryRel(harness.videoResource, "activeMediaRecoveryTask");
		expect(activeTasks).toHaveLength(1);
		const task = activeTasks[0]!;
		const candidateMetadata = { kind: "video", duration: 10, width: 1920, height: 1080, mime: "video/webm", size: 1000, lastModified: 100 };
		await dispatchAndSettle(harness.ctx, task, "recordInspection", {
			operationId: recoveryAttempt.operationId,
			classification: "compatible-replacement",
			confirmationRequired: false,
			candidateMetadata,
			candidateFingerprint: "sha256:binding-candidate",
			candidateFingerprintVersion: "sha256-v1",
			updatedAt: 101,
		});
		expect(getAttr(task, "phase")).toBe("ready-to-commit");
		await dispatchAndSettle(harness.ctx, task, "requestCommit", { operationId: recoveryAttempt.operationId, updatedAt: 102 });
		expect(getAttr(task, "phase")).toBe("committing");
		const commitRequest = requests.at(-1)!;
		expect(commitRequest).toMatchObject({
			mode: "commit",
			taskId: task._node_id,
			resourceId: harness.videoResource._node_id,
			operationId: recoveryAttempt.operationId,
			runtimeHandleId: recoveryAttempt.runtimeHandleId,
			candidateMetadata,
			candidateFingerprint: "sha256:binding-candidate",
			candidateFingerprintVersion: "sha256-v1",
		});
		const candidatePointer = {
			assetStorageKind: "project-copy",
			assetRef: "project/binding/resource/binding/asset/operation:binding",
			sourceKind: "file-handle",
			sourceRef: "handle:binding",
			url: "blob:binding-playback",
			contentFingerprint: "sha256:binding-candidate",
			fingerprintVersion: "sha256-v1",
			duration: 10,
			width: 1920,
			height: 1080,
			localMediaAvailability: "ready-project-copy",
			originalAccessStatus: "granted",
		};
		await dispatchAndSettle(harness.ctx, task, "completePublication", {
			...commitRequest,
			projectId: harness.project._node_id,
			bootId: recoveryAttempt.bootId,
			attemptId: recoveryAttempt.attemptId,
			pointer: candidatePointer,
			candidateFileMetadata: { mime: "video/webm", size: 1000, lastModified: 100 },
			updatedAt: 103,
		});
		expect(getAttr(harness.videoResource, "assetRef")).toBe(candidatePointer.assetRef);
		expect(getAttr(harness.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
		expect(getAttr(task, "phase")).toBe("committing");
		expect(getAttr(task, "outcome")).not.toBe("completed");
	});

	it("moves confirmation into committing and emits a serializable commit request", async () => {
		const requests: unknown[] = []; const harness = await createActionContractHarness({ interfaces: { mediaRecoveryRuntime: { requestMediaRecovery: (payload: unknown) => requests.push(payload) } } });
		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", { ...attempt("boot:commit", "operation:commit"), runtimeHandleId: "runtime:commit" });
		const task = (await queryRel(harness.videoResource, "activeMediaRecoveryTask"))[0]!;
		await dispatchAndSettle(harness.ctx, task, "recordInspection", { operationId: "operation:commit", classification: "compatible-replacement", confirmationRequired: true, candidateMetadata: { duration: 10 }, updatedAt: 2 });
		expect(getAttr(task, "phase")).toBe("awaiting-confirmation");
		await dispatchAndSettle(harness.ctx, task, "requestCommit", { operationId: "operation:commit", updatedAt: 3 });
		expect(getAttr(task, "phase")).toBe("committing");
		expect(requests.at(-1)).toMatchObject({ mode: "commit", operationId: "operation:commit", runtimeHandleId: "runtime:commit", resourceId: harness.videoResource._node_id });
	});

	it("declares recovery operational state as a local-only model", () => {
		const typedModel = MediaRecoveryTask as unknown as {
			crdt?: { mode?: string };
			prototype?: { crdt?: { mode?: string }; __crdt_meta?: { fields?: unknown[] } };
		};
		const meta = typedModel.crdt ?? typedModel.prototype?.crdt;
		expect(meta?.mode).toBe("local");
		expect(typedModel.prototype?.__crdt_meta?.fields ?? []).toHaveLength(0);
	});
});

type Harness = Awaited<ReturnType<typeof createActionContractHarness>>;
type PublicationHarness = Pick<Harness, "ctx" | "project" | "videoResource" | "mediaRecoveryRequests">;
const preparePublication = async (h: PublicationHarness, resource = h.videoResource, suffix = "A") => {
	const operationId = "op:" + suffix;
	await dispatchAndSettle(h.ctx, resource, "startMediaRecovery", { ...attempt("boot:" + suffix, operationId), intent: "replace-source", runtimeHandleId: "runtime:" + suffix });
	const task = (await queryRel(resource, "activeMediaRecoveryTask"))[0]!;
	const metadata = { kind: getAttr(resource, "kind"), duration: Number(getAttr(resource, "duration")), width: null, height: null };
	await dispatchAndSettle(h.ctx, task, "recordInspection", { operationId, classification: "compatible-replacement", confirmationRequired: false, candidateMetadata: metadata, candidateFingerprint: "fp:" + suffix, candidateFingerprintVersion: "sha256-v1", updatedAt: 101 });
	await dispatchAndSettle(h.ctx, task, "requestCommit", { operationId, updatedAt: 102 });
	const request = h.mediaRecoveryRequests.at(-1) as Record<string, unknown>;
	const proposal = { ...request, candidateFileMetadata: { mime: "video/webm", size: 4, lastModified: 1 }, pointer: { assetStorageKind: "project-copy", assetRef: "project/" + h.project._node_id + "/resource/" + resource._node_id + "/asset/" + suffix, sourceKind: "file-handle", sourceRef: "handle:" + suffix, url: "blob:playback:" + suffix, contentFingerprint: "fp:" + suffix, fingerprintVersion: "sha256-v1", duration: metadata.duration, width: null, height: null, localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted" }, updatedAt: 103 };
	return { task, proposal };
};
const publish = async (h: Harness, resource = h.videoResource, suffix = "A") => {
	const prepared = await preparePublication(h, resource, suffix);
	await dispatchAndSettle(h.ctx, prepared.task, "completePublication", prepared.proposal);
	expect(getAttr(resource, "assetRef")).toBe(prepared.proposal.pointer.assetRef);
	return prepared;
};
const owned = (h: Harness) => getAttr(h.ctx.appModel, "localMediaPublicationManifest") as PublicationManifest;

describe("Root captured local media ownership", () => {
	it("C1 retires both published originals over two declared membership frames", async () => {
		let firstMembers: readonly unknown[] = []; let secondMembers: readonly unknown[] = [];
		const h = await createActionContractHarness();
		const rootProjects = Object.freeze(await queryRel(h.ctx.appModel, "project"));
		expect(rootProjects).toContain(h.project);
		expect(rootProjects.find((project) => project._node_id === h.project._node_id)).toBe(h.project);
		await publish(h, h.videoResource, "A"); await publish(h, h.audioResource, "C");
		expect(owned(h).accepted.filter((x) => x.eligible).map((x) => x.resourceId).sort()).toEqual([h.videoResource._node_id, h.audioResource._node_id].sort());
		const before = await queryRel(h.project, "resources");
		firstMembers = Object.freeze(before.filter((x) => x !== h.videoResource));
		secondMembers = Object.freeze(firstMembers.filter((x) => x !== h.audioResource));
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, h.ctx.appModel, "removePublished", { project: h.project, firstMembers, secondMembers });
		expect(await queryRel(h.ctx.appModel, "project")).toEqual(rootProjects);
		expect(await queryRel(h.project, "resources")).toEqual(secondMembers);
		expect(owned(h)).toEqual({ accepted: [], candidates: [] });
		expect(h.publicationRetirements.map((x) => (x as { resourceId: string }).resourceId).sort()).toEqual([h.videoResource._node_id, h.audioResource._node_id].sort());
	});
	it("C2 does not fabricate retirement of an intermediate imported candidate", async () => {
		console.info("C2:start");
		let beforeMembers: readonly unknown[] = [];
		console.info("C2:composition-ready");
		const h = await createActionContractHarness();
		console.info("C2:harness-ready");
		let rootProjects: readonly Harness["project"][] = [];
		console.info("C2:pre-call");
		await h.ctx.lockToRead(async () => {
			console.info("C2:pre-enter");
			const preProjects = await queryNativeRel(h.ctx.appModel as never, "project").then((result: unknown) => Array.isArray(result) ? result.filter(Boolean) as Harness["project"][] : result && typeof result === "object" && "_node_id" in result ? [result as Harness["project"]] : []);
			console.info("C2:pre-project-read");
			rootProjects = Object.freeze(preProjects);
			expect(rootProjects).toContain(h.project);
			expect(rootProjects.find((project) => project._node_id === h.project._node_id)).toBe(h.project);
			const preResources = await queryNativeRel(h.project as never, "resources").then((result: unknown) => Array.isArray(result) ? result.filter(Boolean) as Harness["project"][] : result && typeof result === "object" && "_node_id" in result ? [result as Harness["project"]] : []);
			console.info("C2:pre-resources-read");
			beforeMembers = Object.freeze(preResources);
			const preManifest = (await queryNativeAttr(h.ctx.appModel as never, "localMediaPublicationManifest")) ?? null;
			console.info("C2:pre-manifest-read");
			expect(preManifest)
				.toEqual({ accepted: [], candidates: [] });
			console.info("C2:pre-callback-end");
		});
		console.info("C2:pre-settled");
		console.info("C2:mutation-call");
		await dispatchAndSettle(h.ctx, h.project, "transientCandidate", {
			name: "B.webm", kind: "video", url: "blob:B", mime: "video/webm",
			duration: 4, size: 4, operationId: "op:B", attemptId: "attempt:B",
			bootId: "boot:B", runtimeHandleId: "runtime:B", recoveryKind: "import", intent: "restore",
		});
		console.info("C2:mutation-settled");
		await h.ctx.lockToRead(async () => {
			console.info("C2:post-enter");
			const postProjects = await queryNativeRel(h.ctx.appModel as never, "project").then((result: unknown) => Array.isArray(result) ? result.filter(Boolean) as Harness["project"][] : result && typeof result === "object" && "_node_id" in result ? [result as Harness["project"]] : []);
			console.info("C2:post-project-read");
			expect(postProjects).toEqual(rootProjects);
			expect(h.mediaRecoveryRequests)
				.toEqual([expect.objectContaining({ operationId: "op:B", runtimeHandleId: "runtime:B" })]);
			console.info("C2:post-request-checked");
			const postResources = await queryNativeRel(h.project as never, "resources").then((result: unknown) => Array.isArray(result) ? result.filter(Boolean) as Harness["project"][] : result && typeof result === "object" && "_node_id" in result ? [result as Harness["project"]] : []);
			console.info("C2:post-resources-read");
			expect(postResources).toEqual(beforeMembers);
			const postManifest = (await queryNativeAttr(h.ctx.appModel as never, "localMediaPublicationManifest")) ?? null;
			console.info("C2:post-manifest-read");
			expect(postManifest)
				.toEqual({ accepted: [], candidates: [] });
			expect(h.publicationRetirements).toEqual([]);
			console.info("C2:post-callback-end");
		});
		console.info("C2:post-settled");
	});
	it("C3 keeps identical same-transaction membership and preserves a separate unlink retirement", async () => {
		let firstMembers: readonly unknown[] = []; let finalMembers: readonly unknown[] = [];
		const h = await createActionContractHarness();
		const rootProjects = Object.freeze(await queryRel(h.ctx.appModel, "project"));
		expect(rootProjects).toContain(h.project);
		expect(rootProjects.find((project) => project._node_id === h.project._node_id)).toBe(h.project);
		await publish(h);
		finalMembers = Object.freeze(await queryRel(h.project, "resources"));
		firstMembers = Object.freeze(finalMembers.filter((x) => x !== h.videoResource));
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, h.ctx.appModel, "unlinkRelink", { project: h.project, firstMembers, finalMembers });
		expect(await queryRel(h.ctx.appModel, "project")).toEqual(rootProjects);
		expect(h.publicationRetirements).toEqual([]);
		expect(owned(h).accepted).toHaveLength(1);
		await dispatchAndSettle(h.ctx, h.project, "setResources", { resources: firstMembers });
		const held = [...h.publicationRetirements];
		await dispatchAndSettle(h.ctx, h.project, "setResources", { resources: finalMembers });
		expect(held).toEqual([expect.objectContaining({ resourceId: h.videoResource._node_id, sequence: 1 })]);
		expect(h.publicationRetirements).toEqual(held);
	});
	it("C4 bootstrap produces no historical physical retirement", async () => {
		const h = await createActionContractHarness();
		expect(owned(h)).toEqual({ accepted: [], candidates: [] });
		expect(h.publicationRetirements).toEqual([]);
	});
	it("C5 processes captured ownership during genuine API initialization", async () => {
		const h = await createActionContractHarness();
		const rootProjects = Object.freeze(await queryRel(h.ctx.appModel, "project"));
		expect(rootProjects).toContain(h.project);
		expect(rootProjects.find((project) => project._node_id === h.project._node_id)).toBe(h.project);
		await publish(h);
		const finalMembers = Object.freeze((await queryRel(h.project, "resources")).filter((x) => x !== h.videoResource));
		await dispatchAndSettle(h.ctx, h.ctx.appModel, "armApiInitUnlink", { project: h.project, resources: finalMembers });
		expect(owned(h).accepted).toHaveLength(1);
		const root = h.ctx.appModel as typeof h.ctx.appModel & { getInterface(name: string): unknown; useInterface(name: string, api: unknown): void };
		const api = root.getInterface("mediaRecoveryRuntime");
		expect(api).toMatchObject({ releaseMediaPublication: expect.any(Function), publishMediaPublicationDecision: expect.any(Function) });
		h.publicationRetirements.length = 0;
		await h.ctx.lockToRead(() => root.useInterface("mediaRecoveryRuntime", null));
		expect(owned(h).accepted).toHaveLength(1);
		expect(h.publicationRetirements).toEqual([]);
		await h.ctx.lockToRead(() => root.useInterface("mediaRecoveryRuntime", api));
		expect(await queryRel(h.ctx.appModel, "project")).toEqual(rootProjects);
		expect(await queryRel(h.project, "resources")).toEqual(finalMembers);
		expect(owned(h)).toEqual({ accepted: [], candidates: [] });
		expect(h.publicationRetirements).toEqual([expect.objectContaining({ resourceId: h.videoResource._node_id, sequence: 1 })]);
	});
	it("C6 internal constant-only capture has no historical release", () => {
		expect(capturedPublicationRetirements({ prev_values: { _node_id: "root" }, next_values: { _node_id: "root" }, values: { localMediaPublicationManifest: { accepted: [], candidates: [] } }, created_by_inited_api: true })).toEqual([]);
	});
	it("C7 internal one-sided capture throws before any physical action", () => {
		expect(() => capturedPublicationRetirements({ prev_values: { localMediaPublicationManifest: { accepted: [], candidates: [] } }, next_values: {} })).toThrow("One-sided");
	});
});
describe("publication full tuple and completion guards", () => {
	it.each(["projectId", "resourceId", "taskId", "operationId", "attemptId", "bootId", "runtimeHandleId", "candidateMetadata", "candidateFingerprint", "candidateFingerprintVersion"] as const)("D3 rejects a mismatched %s without advancing Resource", async (field) => {
		const h = await createActionContractHarness(); const { task, proposal } = await preparePublication(h);
		await dispatchAndSettle(h.ctx, task, "completePublication", { ...proposal, [field]: field === "candidateMetadata" ? { ...(proposal.candidateMetadata as object), streams: { videoStreams: 1, audioStreams: 0 } } : "wrong" });
		expect(getAttr(h.videoResource, "localPublicationSequence")).toBe(0);
		expect(getAttr(h.videoResource, "assetRef")).not.toBe(proposal.pointer.assetRef);
		expect(getAttr(task, "publicationReceipt")).toBeNull();
	});
	it.each(["removed", "unlinked"] as const)("D2 rejects publication after Resource is %s", async (mode) => {
		const h = await createActionContractHarness(); const { task, proposal } = await preparePublication(h);
		if (mode === "removed") await dispatchAndSettle(h.ctx, h.videoResource, "removeSelf");
		else await dispatchAndSettle(h.ctx, h.project, "setResources", { resources: (await queryRel(h.project, "resources")).filter((x) => x !== h.videoResource) });
		await dispatchAndSettle(h.ctx, task, "completePublication", proposal);
		expect(getAttr(h.videoResource, "assetRef")).not.toBe(proposal.pointer.assetRef);
		expect(getAttr(task, "phase")).not.toBe("completed");
	});
	it("D4 rejects a newer invalid candidate without fencing an accepted receipt", async () => {
		const h = await createActionContractHarness(); const { task, proposal } = await publish(h);
		const receipt = getAttr(task, "publicationReceipt");
		const originalTaskState = await queryAttr(task, "publicationState");
		await dispatchAndSettle(h.ctx, h.videoResource, "completeMediaRecovery", { ...proposal, attemptId: "newer-invalid" });
		expect(getAttr(h.videoResource, "localPublicationSequence")).toBe(1);
		expect(getAttr(task, "publicationReceipt")).toEqual(receipt);
		await h.ctx.lockToRead(async () => {
			const names = ["localAcceptedPublication", "$meta$removed", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "url", "contentFingerprint", "fingerprintVersion", "duration", "width", "height", "localMediaAvailability", "originalAccessStatus"] as const;
			const values = await queryNativeManyAttrs(h.videoResource as never, names);
			const projectId = await queryNativeAddr(h.videoResource as never, "< @one:_node_id < project");
			const projectRemoved = await queryNativeAddr(h.videoResource as never, "< @one:$meta$removed < project");
			logPublicationDiagnostic("D4-after-invalid-before-validity-guard", {
				dependencies: Object.fromEntries([...names.map((name, index) => [name, values[index]]), ["< @one:_node_id < project", projectId], ["< @one:$meta$removed < project", projectRemoved]]),
				acceptedPointer: (values[0] as { pointer?: unknown } | null | undefined)?.pointer,
			});
		});
		const acceptedInput = await queryAttr(h.videoResource, "localAcceptedPublication");
		const validity = await queryAttr(h.videoResource, "localPublicationValidity");
		const taskState = await queryAttr(task, "publicationState");
		const actualActiveTasks = await queryRel(h.videoResource, "activeMediaRecoveryTask");
		expect(acceptedInput).toEqual(receipt);
		expect(validity).not.toBeNull();
		expect(validity).toMatchObject({ eligible: true, accepted: receipt });
		expect(taskState).toEqual(originalTaskState);
		expect(taskState).toMatchObject({ taskId: task._node_id, publicationReceipt: receipt });
		expect(actualActiveTasks).toEqual([task]);
		await dispatchAndSettle(h.ctx, task, "recordPublicationBindingResult", { ...(receipt as object), outcome: "installed", boundaryUpdatedAt: 104 });
		expect(getAttr(task, "phase")).toBe("completed");
	});
	it("D6 automatic and generic completion cannot bypass a requested publication", async () => {
		const h = await createActionContractHarness();
		const restoreSnapshot = await captureRestoreSnapshot(h);
		const { task, proposal } = await preparePublication(h);
		const beforeRequested = capturePublicationState(h, task);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", restoreSnapshot, updatedAt: 104 });
		expect(capturePublicationState(h, task)).toEqual(beforeRequested);
		await dispatchAndSettle(h.ctx, task, "completePublication", proposal);
		const accepted = capturePublicationState(h, task);
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", restoreSnapshot, updatedAt: 105 });
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", updatedAt: 106 });
		await dispatchAndSettle(h.ctx, task, "transition", { operationId: "op:A", phase: "completed", updatedAt: 107 });
		expect(capturePublicationState(h, task)).toEqual(accepted);
		expect(getAttr(task, "phase")).toBe("committing");
		expect(getAttr(task, "publicationReceipt")).not.toBeNull();
		expect(h.publicationRetirements).toEqual([]);
	});
	it("D3 duplicate publication replays one immutable receipt without a pointer rewrite", async () => {
		const h = await createActionContractHarness(); const { task, proposal } = await publish(h);
		const receipt = getAttr(task, "publicationReceipt");
		await dispatchAndSettle(h.ctx, task, "completePublication", { ...proposal, pointer: { ...proposal.pointer, url: "blob:forged" } });
		expect(getAttr(h.videoResource, "url")).toBe(proposal.pointer.url);
		expect(getAttr(task, "publicationReceipt")).toEqual(receipt);
		expect(getAttr(h.videoResource, "localPublicationSequence")).toBe(1);
	});
});
describe("publication receipt atomic failure boundaries", () => {
	it("D5 a real durable commit failure exposes neither pointer nor Task receipt nor accepted decision", async () => {
		const storage = makeDktCrdtMemoryStorage() as ReturnType<typeof makeDktCrdtMemoryStorage> & { failNextCommit(): void; cloneData(): Map<string, unknown> };
		const fake = createEffectContractFakes();
		const ctx = await bootDktModels({ App: MediaContractTestRoot, interfaces: fake.interfaces as unknown as Record<string, unknown>, crdt: { enabled: true, peerId: "publication-durable-test", storage } });
		await dispatchAndSettle(ctx, ctx.sessionRoot, "createProject", { title: "Atomic publication", fps: 30, width: 320, height: 240, duration: 4 });
		const project = (await queryRel(ctx.sessionRoot, "activeProject"))[0]!;
		await dispatchAndSettle(ctx, project, "importResource", { name: "before.webm", kind: "video", duration: 4, mime: "video/webm", url: "https://example.invalid/before", size: 4, source: { kind: "local" }, status: "ready", data: { status: "ready" } });
		const resource = (await queryRel(project, "resources"))[0]!;
		const { task, proposal } = await preparePublication({ ctx, project, videoResource: resource, mediaRecoveryRequests: fake.mediaRecoveryCalls });
		const beforeData = storage.cloneData(); const beforeAsset = getAttr(resource, "assetRef");
		storage.failNextCommit();
		await expect(dispatchAndSettle(ctx, task, "completePublication", proposal)).rejects.toThrow("memory atomic commit failed");
		expect(getAttr(resource, "assetRef")).toBe(beforeAsset);
		expect(getAttr(resource, "localPublicationSequence")).toBe(0);
		expect(getAttr(task, "publicationReceipt")).toBeNull();
		expect(getAttr(task, "phase")).toBe("committing");
		expect(fake.publicationDecisionCalls).toEqual([]);
		expect(storage.cloneData()).toEqual(beforeData);
	});
	it("D5 public receipt guard throws rather than silently accepting a mismatched tuple", async () => {
		const h = await createActionContractHarness(); const { task } = await publish(h);
		const beforeAsset = getAttr(h.videoResource, "assetRef"); const receipt = getAttr(task, "publicationReceipt");
		await expect(dispatchAndSettle(h.ctx, task, "recordPublicationDecision", { ...(receipt as object), attemptId: "wrong-attempt" })).rejects.toThrow("receipt guard rejected");
		expect(getAttr(task, "publicationReceipt")).toEqual(receipt);
		expect(getAttr(h.videoResource, "assetRef")).toBe(beforeAsset);
	});
});
describe("publication owner changes", () => {
	it("D2 reparenting invalidates the old proposal and old installed result", async () => {
		const h = await createActionContractHarness(); const { task, proposal } = await publish(h);
		const receipt = getAttr(task, "publicationReceipt");
		await dispatchAndSettle(h.ctx, h.sessionRoot, "createProject", { title: "New owner", fps: 30, width: 320, height: 240, duration: 4 });
		const newProject = (await queryRel(h.sessionRoot, "activeProject"))[0]!;
		await dispatchAndSettle(h.ctx, h.project, "setResources", { resources: (await queryRel(h.project, "resources")).filter((x) => x !== h.videoResource) });
		await dispatchAndSettle(h.ctx, newProject, "setResources", { resources: [h.videoResource] });
		expect((await queryRel(h.videoResource, "project"))[0]?._node_id).toBe(newProject._node_id);
		await dispatchAndSettle(h.ctx, task, "completePublication", proposal);
		expect(h.publicationDecisions.at(-1)).toMatchObject({ decision: receipt, bindingEligibility: "obsolete" });
		await dispatchAndSettle(h.ctx, task, "recordPublicationBindingResult", { ...(receipt as object), outcome: "installed", boundaryUpdatedAt: 104 });
		expect(getAttr(task, "phase")).not.toBe("completed");
	});
	it("D3 a new active attempt rejects a late installed result for the old receipt", async () => {
		const h = await createActionContractHarness(); const { task } = await publish(h);
		const receipt = getAttr(task, "publicationReceipt");
		await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", { ...attempt("boot:new", "op:new"), runtimeHandleId: "runtime:new", intent: "replace-source" });
		expect((await queryRel(h.videoResource, "activeMediaRecoveryTask"))[0]?._node_id).not.toBe(task._node_id);
		await dispatchAndSettle(h.ctx, task, "recordPublicationBindingResult", { ...(receipt as object), outcome: "installed", boundaryUpdatedAt: 104 });
		expect(getAttr(task, "phase")).toBe("interrupted");
		expect(getAttr(task, "outcome")).toBe("interrupted");
	});
});
describe("canonical publication invalidation", () => {
	it("L1 a real peer Resource tombstone retires the local accepted identity", async () => {
		const pair = await createCrdtWorkerPair({ App: MediaContractTestRoot, roomId: "media-publication-canonical-remove", profileId: "minicut-crdt-v1", profileVersion: 1 });
		try {
			await pair.a.dispatch(pair.a.project, "importResource", { name: "canonical.webm", kind: "video", duration: 4, mime: "video/webm", size: 4, url: "https://example.invalid/canonical", status: "ready", source: { kind: "local" }, data: { status: "ready" } });
			await pair.waitForConvergence();
			const resourceA = (await queryRel(pair.a.project, "resources")).find((r) => getAttr(r, "name") === "canonical.webm")!;
			const resourceB = (await queryRel(pair.b.project, "resources")).find((r) => r._node_id === resourceA._node_id)!;
			expect(resourceB).toBeTruthy();
			const prepared = await preparePublication({ ctx: pair.a.ctx, project: pair.a.project, videoResource: resourceA, mediaRecoveryRequests: pair.a.effects.mediaRecoveryCalls });
			await dispatchAndSettle(pair.a.ctx, prepared.task, "completePublication", prepared.proposal);
			expect(getAttr(resourceA, "assetRef")).toBe(prepared.proposal.pointer.assetRef);
			await pair.a.ctx.lockToRead(async () => {
				logPublicationDiagnostic("L1-prior-peer-remove:start", {});
				const rawRootProjects = await queryNativeRel(pair.a.ctx.appModel as never, "project");
				const rootProjects = rawRootProjects == null ? [] : Array.isArray(rawRootProjects) ? rawRootProjects : [rawRootProjects];
				const rawProjectResources = await queryNativeRel(pair.a.project as never, "resources");
				const projectResources = rawProjectResources == null ? [] : Array.isArray(rawProjectResources) ? rawProjectResources : [rawProjectResources];
				const rawResourceProjects = await queryNativeRel(resourceA as never, "project");
				const resourceProjects = rawResourceProjects == null ? [] : Array.isArray(rawResourceProjects) ? rawResourceProjects : [rawResourceProjects];
				const rawDirectRootedResources = await queryNativeAddr(pair.a.ctx.appModel as never, diagnosticAddr({ relPath: ["project", "resources"], zip: "all" }));
				const directRootedResources = rawDirectRootedResources == null ? [] : Array.isArray(rawDirectRootedResources) ? rawDirectRootedResources : [rawDirectRootedResources];
				const rawResources = await queryNativeRel(pair.a.ctx.appModel as never, "resource");
				const rootResources = rawResources == null ? [] : Array.isArray(rawResources) ? rawResources : [rawResources];
				const [validity, removed] = await queryNativeManyAttrs(resourceA as never, ["localPublicationValidity", "$meta$removed"]);
				const aggregate = await queryNativeAddr(pair.a.ctx.appModel as never, "< @all:localPublicationValidity < resource");
				const [manifest] = await queryNativeManyAttrs(pair.a.ctx.appModel as never, ["localMediaPublicationManifest"]);
				logPublicationDiagnostic("L1-prior-peer-remove", {
					testedProjectId: pair.a.project._node_id, testedResourceId: resourceA._node_id,
					rawRootProjectIds: rootProjects.map((project) => (project as { _node_id?: unknown })._node_id),
					rawProjectResourceIds: projectResources.map((resource) => (resource as { _node_id?: unknown })._node_id),
					rawResourceProjectIds: resourceProjects.map((project) => (project as { _node_id?: unknown })._node_id),
					directRootedResourceIds: directRootedResources.map((resource) => (resource as { _node_id?: unknown })._node_id),
					rootResourceIds: rootResources.map((resource) => (resource as { _node_id?: unknown })._node_id), validity, removed,
					aggregateIsArray: Array.isArray(aggregate), aggregateType: typeof aggregate, aggregate, manifest,
				});
			});
			pair.a.effects.publicationRetirementCalls.length = 0;
			await pair.b.dispatch(resourceB, "removeSelf"); await pair.waitForConvergence();
			await pair.a.ctx.lockToRead(async () => {
				logPublicationDiagnostic("L1-final-peer-remove:start", {});
				const rawResources = await queryNativeRel(pair.a.ctx.appModel as never, "resource");
				const rootResources = rawResources == null ? [] : Array.isArray(rawResources) ? rawResources : [rawResources];
				const [validity, removed] = await queryNativeManyAttrs(resourceA as never, ["localPublicationValidity", "$meta$removed"]);
				const aggregate = await queryNativeAddr(pair.a.ctx.appModel as never, "< @all:localPublicationValidity < resource");
				const [manifest] = await queryNativeManyAttrs(pair.a.ctx.appModel as never, ["localMediaPublicationManifest"]);
				logPublicationDiagnostic("L1-final-peer-remove", {
					rootResourceIds: rootResources.map((resource) => (resource as { _node_id?: unknown })._node_id), validity, removed,
					aggregateIsArray: Array.isArray(aggregate), aggregateType: typeof aggregate, aggregate, manifest,
				});
			});
			expect(pair.a.effects.publicationRetirementCalls).toEqual([expect.objectContaining({ resourceId: resourceA._node_id, sequence: 1 })]);
			const manifest = getAttr(pair.a.ctx.appModel, "localMediaPublicationManifest") as PublicationManifest;
			expect(manifest.accepted.filter((item) => item.eligible && item.resourceId === resourceA._node_id)).toEqual([]);
		} finally { pair.close(); }
	});
});
describe("rooted Project publication membership", () => {
	it("D2 unlinking the owning Project retires the actual original publication", async () => {
		let remainingProjects: readonly unknown[] = [];
		const h = await createActionContractHarness();
		const rootProjects = Object.freeze(await queryRel(h.ctx.appModel, "project"));
		expect(rootProjects).toContain(h.project);
		expect(rootProjects.find((project) => project._node_id === h.project._node_id)).toBe(h.project);
		remainingProjects = Object.freeze(rootProjects.filter((project) => project !== h.project));
		await publish(h);
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, h.ctx.appModel, "unlinkProjects", { projects: remainingProjects });
		expect(await queryRel(h.ctx.appModel, "project")).toEqual(remainingProjects);
		expect(owned(h)).toEqual({ accepted: [], candidates: [] });
		expect(h.publicationRetirements).toEqual([expect.objectContaining({ projectId: h.project._node_id, resourceId: h.videoResource._node_id, sequence: 1 })]);
	});
});
describe("publication action output guards", () => {
	it("D3 malformed public wrappers cannot enter the accepted replay or proposal steps", async () => {
		const h = await createActionContractHarness(); const { task, proposal } = await preparePublication(h);
		await dispatchAndSettle(h.ctx, task, "completePublication", { proposal });
		await dispatchAndSettle(h.ctx, task, "completePublication", { replay: { decision: { ...proposal, kind: "accepted", sequence: 100 }, bindingEligibility: "current" } });
		expect(h.publicationDecisions).toEqual([]);
		expect(getAttr(h.videoResource, "assetRef")).not.toBe(proposal.pointer.assetRef);
		expect(getAttr(task, "phase")).toBe("committing");
	});
});

const captureRestoreSnapshot = async (h: Harness): Promise<Record<string, unknown>> => {
	let snapshot!: Record<string, unknown>;
	await h.ctx.lockToRead(async () => {
		const [assetStorageKind, assetRef, sourceKind, sourceRef, rawSequence] = await queryNativeManyAttrs(h.videoResource as never, ["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "localPublicationSequence"]);
		const rawProject = await queryNativeRel(h.videoResource as never, "project");
		const project = Array.isArray(rawProject) ? rawProject[0] : rawProject;
		const normalizedSourceRef = typeof sourceRef === "string" ? sourceRef : null;
		snapshot = {
			resourceId: h.videoResource._node_id, projectId: (project as Harness["project"])._node_id,
			assetStorageKind, assetRef: typeof assetRef === "string" ? assetRef : null,
			sourceKind, sourceRef: normalizedSourceRef,
			handleRef: sourceKind === "file-handle" ? normalizedSourceRef : null,
			publicationSequencePresent: rawSequence !== undefined,
			publicationSequence: rawSequence === undefined ? null : rawSequence,
		};
	});
	return snapshot;
};
const capturePublicationState = (h: Harness, task?: Harness["videoResource"]) => ({
	resource: Object.fromEntries(["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "url", "contentFingerprint", "fingerprintVersion", "duration", "width", "height", "localMediaAvailability", "originalAccessStatus", "localPublicationSequence", "localAcceptedPublication"].map((key) => [key, getAttr(h.videoResource, key)])),
	task: task ? Object.fromEntries(["phase", "outcome", "publicationReceipt", "publicationRequested"].map((key) => [key, getAttr(task, key)])) : null,
});

describe("captured automatic restore admission and current backing", () => {

	it("first replica publication preserves current backing and advances missing host sequence", async () => {
		// A peer with no local publication history admits its first valid receipt while preserving current backing.
		// Strict receipt absence is a public premise; only accepted pointer and receipt writes allocate host order.
		const pair = await createCrdtWorkerPair({ App: productionMiniCutAppRoot, roomId: "media-replica-first-publication", profileId: "minicut-crdt-v1", profileVersion: 1 });
		try {
			const operationA = "op:replica-first:A:import";
			await dispatchAndSettle(pair.a.ctx, pair.a.project, "importResource", {
				name: "replica-first.webm", kind: "video", duration: 4, mime: "video/webm", size: 4, url: "https://example.invalid/replica-first", status: "ready", source: { kind: "local" }, data: { status: "ready" },
				operationId: operationA, attemptId: "attempt:replica-first:A:import", bootId: "boot:replica-first:A:import", recoveryKind: "import", intent: "restore", runtimeHandleId: "runtime:replica-first:A", createdAt: 1, updatedAt: 1,
			});
			let resourceA!: Harness["videoResource"];
			let taskA!: Harness["videoResource"];
			await pair.a.ctx.lockToRead(async () => {
				const rawResources = await queryNativeRel(pair.a.project as never, "resources");
				const resources = (Array.isArray(rawResources) ? rawResources : rawResources == null ? [] : [rawResources]) as Harness["videoResource"][];
				expect(resources).toHaveLength(1);
				resourceA = resources[0]!;
				const rawTasks = await queryNativeRel(resourceA as never, "activeMediaRecoveryTask");
				const tasks = (Array.isArray(rawTasks) ? rawTasks : rawTasks == null ? [] : [rawTasks]) as Harness["videoResource"][];
				expect(tasks).toHaveLength(1);
				taskA = tasks[0]!;
				const rawOwner = await queryNativeRel(resourceA as never, "project");
				const owner = (Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as Harness["project"];
				expect(owner._node_id).toBe(pair.a.project._node_id);
				const rawTaskResource = await queryNativeRel(taskA as never, "resource");
				const taskResource = (Array.isArray(rawTaskResource) ? rawTaskResource[0] : rawTaskResource) as Harness["videoResource"];
				expect(taskResource._node_id).toBe(resourceA._node_id);
				const values = await queryNativeManyAttrs(resourceA as never, ["kind", "duration", "width", "height", "localPublicationSequence"]);
				expect(values.slice(0, 2)).toEqual(["video", 4]);
				expect(values[4]).toBe(0);
				expect(await queryNativeManyAttrs(taskA as never, ["operationId", "attemptId", "bootId", "runtimeHandleId"])).toEqual([operationA, "attempt:replica-first:A:import", "boot:replica-first:A:import", "runtime:replica-first:A"]);
			});
			const metadataA = { kind: "video", duration: 4, width: null, height: null };
			await dispatchAndSettle(pair.a.ctx, taskA, "recordInspection", { operationId: operationA, classification: "compatible-replacement", confirmationRequired: false, candidateMetadata: metadataA, candidateFingerprint: "fp:replica:first", candidateFingerprintVersion: "sha256-v1", updatedAt: 101 });
			const aCallsBeforeCommit = pair.a.effects.mediaRecoveryCalls.length;
			await dispatchAndSettle(pair.a.ctx, taskA, "requestCommit", { operationId: operationA, updatedAt: 102 });
			expect(pair.a.effects.mediaRecoveryCalls).toHaveLength(aCallsBeforeCommit + 1);
			const commitRequestA = pair.a.effects.mediaRecoveryCalls.at(-1)!;
			expect(commitRequestA).toMatchObject({ mode: "commit", projectId: pair.a.project._node_id, resourceId: resourceA._node_id, taskId: taskA._node_id, operationId: operationA, attemptId: "attempt:replica-first:A:import", bootId: "boot:replica-first:A:import", runtimeHandleId: "runtime:replica-first:A", candidateMetadata: metadataA, candidateFingerprint: "fp:replica:first", candidateFingerprintVersion: "sha256-v1" });
			const proposalA = Object.freeze(copyPublicationValue({
				...commitRequestA, candidateFileMetadata: { mime: "video/webm", size: 4, lastModified: 1 },
				pointer: { assetStorageKind: "project-copy", assetRef: "project/" + pair.a.project._node_id + "/resource/" + resourceA._node_id + "/asset/replica-first-A", sourceKind: "file-handle", sourceRef: "handle:replica-first-A", url: "blob:playback:replica-first-A", contentFingerprint: commitRequestA.candidateFingerprint, fingerprintVersion: commitRequestA.candidateFingerprintVersion, duration: 4, width: null, height: null, localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted" },
				updatedAt: 103,
			}) as Record<string, unknown>);
			const aDecisionsBefore = pair.a.effects.publicationDecisionCalls.length;
			await dispatchAndSettle(pair.a.ctx, taskA, "completePublication", proposalA);
			expect(pair.a.effects.publicationDecisionCalls).toHaveLength(aDecisionsBefore + 1);
			const envelopeA = pair.a.effects.publicationDecisionCalls.at(-1)!;
			expect(envelopeA).toMatchObject({ bindingEligibility: "current", decision: { kind: "accepted", sequence: 1, pointer: proposalA.pointer } });
			let acceptedA!: AcceptedPublication;
			await pair.a.ctx.lockToRead(async () => {
				const [sequence, accepted] = await queryNativeManyAttrs(resourceA as never, ["localPublicationSequence", "localAcceptedPublication"]);
				const [receipt, phase] = await queryNativeManyAttrs(taskA as never, ["publicationReceipt", "phase"]);
				expect(sequence).toBe(1);
				expect(accepted).toEqual(envelopeA.decision);
				expect(receipt).toEqual(accepted);
				expect(phase).toBe("committing");
				expect(acceptedPublication(accepted)).not.toBeNull();
				acceptedA = copyPublicationValue(accepted) as AcceptedPublication;
			});
			pair.a.flushOutbound();
			await pair.waitForConvergence();
			let resourceB!: Harness["videoResource"];
			let rawBacking!: Record<string, unknown>;
			await pair.b.ctx.lockToRead(async () => {
				const rawResources = await queryNativeRel(pair.b.project as never, "resources");
				const resources = (Array.isArray(rawResources) ? rawResources : rawResources == null ? [] : [rawResources]) as Harness["videoResource"][];
				resourceB = resources.find((resource) => resource._node_id === resourceA._node_id)!;
				expect(resourceB).toBeTruthy();
				const rawOwner = await queryNativeRel(resourceB as never, "project");
				const owner = (Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as Harness["project"];
				expect(owner._node_id).toBe(pair.a.project._node_id);
				const [assetStorageKind, assetRef, sourceKind, sourceRef, sequence, accepted, removed] = await queryNativeManyAttrs(resourceB as never, ["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "localPublicationSequence", "localAcceptedPublication", "$meta$removed"]);
				expect({ assetStorageKind, assetRef, sourceKind, sourceRef }).toEqual({ assetStorageKind: acceptedA.pointer.assetStorageKind, assetRef: acceptedA.pointer.assetRef, sourceKind: acceptedA.pointer.sourceKind, sourceRef: acceptedA.pointer.sourceRef });
				expect(sequence).toBeUndefined();
				expect([null, undefined]).toContain(accepted);
				expect(removed).toBeFalsy();
				const [projectRemoved] = await queryNativeManyAttrs(owner as never, ["$meta$removed"]);
				expect(projectRemoved).toBeFalsy();
				const rawTasks = await queryNativeRel(resourceB as never, "activeMediaRecoveryTask");
				expect(rawTasks == null ? [] : Array.isArray(rawTasks) ? rawTasks : [rawTasks]).toEqual([]);
				rawBacking = { resourceId: resourceB._node_id, projectId: owner._node_id, assetStorageKind, assetRef: typeof assetRef === "string" ? assetRef : null, sourceKind, sourceRef: typeof sourceRef === "string" ? sourceRef : null, handleRef: sourceKind === "file-handle" && typeof sourceRef === "string" ? sourceRef : null };
			});
			pair.partition();
			const operationB = "op:replica-first:B";
			const bCallsBeforeStart = pair.b.effects.mediaRecoveryCalls.length;
			await dispatchAndSettle(pair.b.ctx, resourceB, "startMediaRecovery", { bootId: "boot:replica-first:B", operationId: operationB, attemptId: "attempt:replica-first:B", recoveryKind: "restore", intent: "locate-original", runtimeHandleId: "runtime:replica-first:B", createdAt: 200, updatedAt: 200 });
			expect(pair.b.effects.mediaRecoveryCalls).toHaveLength(bCallsBeforeStart + 1);
			const restoreRequestB = pair.b.effects.mediaRecoveryCalls.at(-1)!;
			expect(restoreRequestB).toMatchObject({ projectId: pair.b.project._node_id, resourceId: resourceB._node_id, operationId: operationB, attemptId: "attempt:replica-first:B", bootId: "boot:replica-first:B", runtimeHandleId: "runtime:replica-first:B" });
			const oldAbsentSnapshot = restoreRequestB.restoreSnapshot;
			expect(oldAbsentSnapshot).toEqual({ ...rawBacking, publicationSequencePresent: false, publicationSequence: null });
			expect(Object.keys(oldAbsentSnapshot as object).sort()).toEqual(["resourceId", "projectId", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "handleRef", "publicationSequencePresent", "publicationSequence"].sort());
			expect(copyPublicationValue(oldAbsentSnapshot)).toEqual(oldAbsentSnapshot);
			let taskB!: Harness["videoResource"];
			await pair.b.ctx.lockToRead(async () => {
				const rawTasks = await queryNativeRel(resourceB as never, "activeMediaRecoveryTask");
				const tasks = (Array.isArray(rawTasks) ? rawTasks : rawTasks == null ? [] : [rawTasks]) as Harness["videoResource"][];
				expect(tasks).toHaveLength(1);
				taskB = tasks[0]!;
				expect(taskB._node_id).toBe(restoreRequestB.taskId);
				const rawResource = await queryNativeRel(taskB as never, "resource");
				const taskResource = (Array.isArray(rawResource) ? rawResource[0] : rawResource) as Harness["videoResource"];
				expect(taskResource._node_id).toBe(resourceB._node_id);
				const rawOwner = await queryNativeRel(resourceB as never, "project");
				expect(((Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as Harness["project"])._node_id).toBe(pair.b.project._node_id);
				const values = await queryNativeManyAttrs(taskB as never, ["phase", "publicationRequested", "publicationReceipt", "operationId", "attemptId", "bootId", "runtimeHandleId"]);
				expect(values.slice(0, 2)).toEqual(["inspecting", false]);
				expect([null, undefined]).toContain(values[2]);
				expect(values.slice(3)).toEqual([operationB, "attempt:replica-first:B", "boot:replica-first:B", "runtime:replica-first:B"]);
			});
			await dispatchAndSettle(pair.b.ctx, taskB, "recordInspection", { operationId: operationB, classification: "exact-match", confirmationRequired: false, candidateMetadata: acceptedA.candidateMetadata, candidateFingerprint: acceptedA.candidateFingerprint, candidateFingerprintVersion: acceptedA.candidateFingerprintVersion, updatedAt: 201 });
			const bCallsBeforeCommit = pair.b.effects.mediaRecoveryCalls.length;
			await dispatchAndSettle(pair.b.ctx, taskB, "requestCommit", { operationId: operationB, updatedAt: 202 });
			expect(pair.b.effects.mediaRecoveryCalls).toHaveLength(bCallsBeforeCommit + 1);
			const commitRequestB = pair.b.effects.mediaRecoveryCalls.at(-1)!;
			expect(commitRequestB).toMatchObject({ mode: "commit", projectId: pair.b.project._node_id, resourceId: resourceB._node_id, taskId: taskB._node_id, operationId: operationB, attemptId: "attempt:replica-first:B", bootId: "boot:replica-first:B", runtimeHandleId: "runtime:replica-first:B", candidateMetadata: acceptedA.candidateMetadata, candidateFingerprint: acceptedA.candidateFingerprint, candidateFingerprintVersion: acceptedA.candidateFingerprintVersion });
			const proposalB = Object.freeze({
				...(copyPublicationValue(commitRequestB) as Record<string, unknown>),
				candidateFileMetadata: copyPublicationValue(acceptedA.candidateFileMetadata),
				pointer: copyPublicationValue(acceptedA.pointer),
				updatedAt: 203,
			});
			const tupleB = publicationTuple(proposalB);
			const normalizedProposalB = publicationProposal(proposalB);
			expect(tupleB).toEqual({ projectId: pair.b.project._node_id, resourceId: resourceB._node_id, taskId: taskB._node_id, operationId: operationB, attemptId: "attempt:replica-first:B", bootId: "boot:replica-first:B", runtimeHandleId: "runtime:replica-first:B" });
			expect(normalizedProposalB).not.toBeNull();
			const resourceFields = ["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "url", "contentFingerprint", "fingerprintVersion", "duration", "width", "height", "mime", "size", "lastModified", "localMediaAvailability", "originalAccessStatus", "localPublicationSequence", "localAcceptedPublication"];
			const taskFields = ["phase", "outcome", "publicationRequested", "publicationReceipt", "publicationBindingResult", "stagedAssetRef", "stagedHandleRef", "candidateMetadata", "candidateFingerprint", "candidateFingerprintVersion", "reasonCode", "errorMessage", "updatedAt"];
			let before!: { resourceValues: unknown[]; taskValues: unknown[]; taskState: unknown; transferSnapshot: unknown; resourceRemoved: unknown; projectRemoved: unknown; projectId: unknown; activeTaskId: unknown; taskResourceId: unknown };
			await pair.b.ctx.lockToRead(async () => {
				const resourceValues = await queryNativeManyAttrs(resourceB as never, resourceFields);
				const taskValues = await queryNativeManyAttrs(taskB as never, taskFields);
				const [taskState] = await queryNativeManyAttrs(taskB as never, ["publicationState"]);
				const [transferSnapshot, resourceRemoved] = await queryNativeManyAttrs(resourceB as never, ["transferSnapshot", "$meta$removed"]);
				const rawOwner = await queryNativeRel(resourceB as never, "project");
				const owner = (Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as Harness["project"];
				const [projectRemoved] = await queryNativeManyAttrs(owner as never, ["$meta$removed"]);
				const rawActive = await queryNativeRel(resourceB as never, "activeMediaRecoveryTask");
				const active = (Array.isArray(rawActive) ? rawActive[0] : rawActive) as Harness["videoResource"];
				const rawTaskResource = await queryNativeRel(taskB as never, "resource");
				const taskResource = (Array.isArray(rawTaskResource) ? rawTaskResource[0] : rawTaskResource) as Harness["videoResource"];
				before = { resourceValues, taskValues, taskState, transferSnapshot, resourceRemoved, projectRemoved, projectId: owner._node_id, activeTaskId: active._node_id, taskResourceId: taskResource._node_id };
			});
			expect(resourceFields.slice(8, 10)).toEqual(["width", "height"]);
			for (const index of [8, 9]) expect([null, undefined]).toContain(before.resourceValues[index]);
			expect([normalizedProposalB!.pointer.width, normalizedProposalB!.pointer.height, normalizedProposalB!.candidateMetadata.width, normalizedProposalB!.candidateMetadata.height]).toEqual([null, null, null, null]);
			expect(Object.hasOwn(recordOf(before.transferSnapshot)!, "width")).toBe(true);
			expect(Object.hasOwn(recordOf(before.transferSnapshot)!, "height")).toBe(true);
			expect([recordOf(before.transferSnapshot)!.width, recordOf(before.transferSnapshot)!.height]).toEqual([undefined, undefined]);
			const rawTaskState = recordOf(before.taskState)!;
			expect(rawTaskState).not.toBeNull();
			expect(samePublicationCandidate(normalizedProposalB, { ...rawTaskState, resourceId: resourceB._node_id, projectId: pair.b.project._node_id })).toBe(true);
			expect(rawTaskState).toMatchObject({ phase: "committing", publicationRequested: true, taskId: taskB._node_id, operationId: operationB, attemptId: "attempt:replica-first:B", bootId: "boot:replica-first:B", runtimeHandleId: "runtime:replica-first:B", candidateMetadata: acceptedA.candidateMetadata, candidateFingerprint: acceptedA.candidateFingerprint, candidateFingerprintVersion: acceptedA.candidateFingerprintVersion });
			expect(rawTaskState.removed).toBeFalsy();
			expect([null, undefined]).toContain(rawTaskState.publicationReceipt);
			expect(before.resourceRemoved).toBeFalsy();
			expect(before.projectRemoved).toBeFalsy();
			expect(before.projectId).toBe(tupleB!.projectId);
			expect(before.activeTaskId).toBe(tupleB!.taskId);
			expect(before.taskResourceId).toBe(tupleB!.resourceId);
			expect(recordOf(before.transferSnapshot)).not.toBeNull();
			expect(before.resourceValues.slice(0, 4)).toEqual([acceptedA.pointer.assetStorageKind, acceptedA.pointer.assetRef, acceptedA.pointer.sourceKind, acceptedA.pointer.sourceRef]);
			expect(before.resourceValues[15]).toBeUndefined();
			expect([null, undefined]).toContain(before.resourceValues[16]);
			expect(normalizedProposalB!.pointer.contentFingerprint).toBe(normalizedProposalB!.candidateFingerprint);
			expect(normalizedProposalB!.pointer.fingerprintVersion).toBe(normalizedProposalB!.candidateFingerprintVersion);
			for (const key of ["duration", "width", "height"] as const) {
				if (Object.hasOwn(normalizedProposalB!.candidateMetadata, key)) expect(normalizedProposalB!.pointer[key]).toEqual(normalizedProposalB!.candidateMetadata[key]);
			}
			expect(normalizedProposalB!.candidateFileMetadata).toEqual({ mime: "video/webm", size: 4, lastModified: 1 });
			expect(normalizedProposalB!.updatedAt).toBe(203);
			const bDecisionsBefore = pair.b.effects.publicationDecisionCalls.length;
			await dispatchAndSettle(pair.b.ctx, taskB, "completePublication", proposalB);
			expect(pair.b.effects.publicationDecisionCalls).toHaveLength(bDecisionsBefore + 1);
			const firstEnvelope = pair.b.effects.publicationDecisionCalls.at(-1)!;
			expect(firstEnvelope).toMatchObject({ bindingEligibility: "current", decision: { ...tupleB, kind: "accepted", sequence: 1, pointer: normalizedProposalB!.pointer, candidateFileMetadata: normalizedProposalB!.candidateFileMetadata, previousAcceptedIdentityAndRefs: null } });
			const firstDecision = acceptedPublication(firstEnvelope.decision)!;
			expect(firstDecision).not.toBeNull();
			expect(publicationTuple(firstDecision)).toEqual(tupleB);
			expect(firstEnvelope.decision).toEqual(firstDecision);
			expect([firstDecision.pointer.width, firstDecision.pointer.height, firstDecision.candidateMetadata.width, firstDecision.candidateMetadata.height, firstDecision.acceptedResource.width, firstDecision.acceptedResource.height]).toEqual([null, null, null, null, null, null]);
			const readAcceptedState = async (taskToRead = taskB) => {
				let captured!: typeof before;
				await pair.b.ctx.lockToRead(async () => {
					const resourceValues = await queryNativeManyAttrs(resourceB as never, resourceFields);
				const taskValues = await queryNativeManyAttrs(taskToRead as never, taskFields);
				const [taskState] = await queryNativeManyAttrs(taskToRead as never, ["publicationState"]);
				const [transferSnapshot, resourceRemoved] = await queryNativeManyAttrs(resourceB as never, ["transferSnapshot", "$meta$removed"]);
				const rawOwner = await queryNativeRel(resourceB as never, "project");
				const owner = (Array.isArray(rawOwner) ? rawOwner[0] : rawOwner) as Harness["project"];
				const [projectRemoved] = await queryNativeManyAttrs(owner as never, ["$meta$removed"]);
				const rawActive = await queryNativeRel(resourceB as never, "activeMediaRecoveryTask");
				const active = (Array.isArray(rawActive) ? rawActive[0] : rawActive) as Harness["videoResource"];
				const rawTaskResource = await queryNativeRel(taskToRead as never, "resource");
				const taskResource = (Array.isArray(rawTaskResource) ? rawTaskResource[0] : rawTaskResource) as Harness["videoResource"];
					captured = { resourceValues, taskValues, taskState, transferSnapshot, resourceRemoved, projectRemoved, projectId: owner._node_id, activeTaskId: active._node_id, taskResourceId: taskResource._node_id };
				});
				return captured;
			};
			const firstState = await readAcceptedState();
			const firstResourceValues = resourceFields.map((key, index) => key === "localPublicationSequence" ? 1 : key === "localAcceptedPublication" ? firstDecision : Object.hasOwn(normalizedProposalB!.pointer, key) ? normalizedProposalB!.pointer[key as keyof AcceptedPublication["pointer"]] : Object.hasOwn(normalizedProposalB!.candidateFileMetadata, key) ? normalizedProposalB!.candidateFileMetadata[key as keyof AcceptedPublication["candidateFileMetadata"]] : before.resourceValues[index]);
			const firstTaskValues = taskFields.map((key, index) => key === "publicationReceipt" ? firstDecision : key === "stagedAssetRef" ? firstDecision.pointer.assetRef : key === "stagedHandleRef" ? firstDecision.pointer.sourceRef : before.taskValues[index]);
			const { resourceValues: firstRaw, ...firstRest } = firstState;
			const { resourceValues: beforeRaw, ...beforeRest } = before;
			expect(beforeRaw).toHaveLength(17);
			expect(firstRaw).toHaveLength(17);
			expect(firstResourceValues).toHaveLength(17);
			expect(firstRaw.filter((_, index) => index !== 8 && index !== 9)).toEqual(firstResourceValues.filter((_, index) => index !== 8 && index !== 9));
			for (const index of [8, 9]) expect([null, undefined]).toContain(firstRaw[index]);
			expect([null, undefined]).toContain(before.taskValues[3]);
			expect([null, undefined]).toContain(before.taskValues[4]);
			expect(firstRest).toEqual({
				...beforeRest, taskValues: firstTaskValues,
				taskState: { ...rawTaskState, publicationReceipt: firstDecision, stagedAssetRef: firstDecision.pointer.assetRef, stagedHandleRef: firstDecision.pointer.sourceRef },
				transferSnapshot: { ...Object.fromEntries(Object.entries(recordOf(before.transferSnapshot)!).map(([key, value]) => [key, Object.hasOwn(firstDecision.pointer, key) ? firstDecision.pointer[key as keyof AcceptedPublication["pointer"]] : Object.hasOwn(firstDecision.candidateFileMetadata, key) ? firstDecision.candidateFileMetadata[key as keyof AcceptedPublication["candidateFileMetadata"]] : value])), url: "", width: undefined, height: undefined },
			});
			expect(firstState.taskValues[0]).toBe("committing");
			expect(firstState.taskValues[2]).toBe(true);
			expect([null, undefined]).toContain(firstState.taskValues[4]);
			const replayCount = pair.b.effects.publicationDecisionCalls.length;
			await dispatchAndSettle(pair.b.ctx, taskB, "completePublication", proposalB);
			expect(pair.b.effects.publicationDecisionCalls).toHaveLength(replayCount + 1);
			expect(pair.b.effects.publicationDecisionCalls.at(-1)).toEqual({ decision: firstDecision, bindingEligibility: "current" });
			expect(await readAcceptedState()).toEqual(firstState);
			await dispatchAndSettle(pair.b.ctx, resourceB, "recordAutomaticMediaRecovery", { availability: "ready-project-copy", originalAccess: "granted", restoreSnapshot: oldAbsentSnapshot, updatedAt: 250 });
			expect(await readAcceptedState()).toEqual(firstState);

			const secondOperation = "op:replica-second:B";
			const secondStartCount = pair.b.effects.mediaRecoveryCalls.length;
			await dispatchAndSettle(pair.b.ctx, resourceB, "startMediaRecovery", { operationId: secondOperation, attemptId: "attempt:replica-second:B", bootId: "boot:replica-second:B", runtimeHandleId: "runtime:replica-second:B", recoveryKind: "restore", intent: "locate-original", createdAt: 300, updatedAt: 300 });
			expect(pair.b.effects.mediaRecoveryCalls).toHaveLength(secondStartCount + 1);
			const secondStartRequest = pair.b.effects.mediaRecoveryCalls.at(-1)!;
			expect(secondStartRequest).toMatchObject({ original: { kind: "video", duration: 4, width: null, height: null, streams: { videoStreams: 1, audioStreams: null } }, originalFingerprint: "fp:replica:first", fingerprintVersion: "sha256-v1" });
			const secondMetadata = { kind: "video", duration: 4, width: 128, height: 72, streams: { videoStreams: 1, audioStreams: null } };
			let secondTask!: Harness["videoResource"];
			await pair.b.ctx.lockToRead(async () => {
				const raw = await queryNativeRel(resourceB as never, "activeMediaRecoveryTask");
				const tasks = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]) as Harness["videoResource"][];
				expect(tasks).toHaveLength(1);
				secondTask = tasks[0]!;
				expect(secondTask._node_id).not.toBe(taskB._node_id);
				expect(secondTask._node_id).toBe(pair.b.effects.mediaRecoveryCalls.at(-1)!.taskId);
				expect(await queryNativeManyAttrs(secondTask as never, ["operationId", "attemptId", "bootId", "runtimeHandleId"])).toEqual([secondOperation, "attempt:replica-second:B", "boot:replica-second:B", "runtime:replica-second:B"]);
			});
			await dispatchAndSettle(pair.b.ctx, secondTask, "recordInspection", { operationId: secondOperation, classification: "exact-match", confirmationRequired: false, candidateMetadata: secondMetadata, candidateFingerprint: firstDecision.candidateFingerprint, candidateFingerprintVersion: firstDecision.candidateFingerprintVersion, updatedAt: 301 });
			const secondCommitCount = pair.b.effects.mediaRecoveryCalls.length;
			await dispatchAndSettle(pair.b.ctx, secondTask, "requestCommit", { operationId: secondOperation, updatedAt: 302 });
			expect(pair.b.effects.mediaRecoveryCalls).toHaveLength(secondCommitCount + 1);
			const secondRequest = pair.b.effects.mediaRecoveryCalls.at(-1)!;
			expect(secondRequest).toMatchObject({ mode: "commit", projectId: pair.b.project._node_id, resourceId: resourceB._node_id, taskId: secondTask._node_id, operationId: secondOperation, attemptId: "attempt:replica-second:B", bootId: "boot:replica-second:B", runtimeHandleId: "runtime:replica-second:B", candidateMetadata: secondMetadata, candidateFingerprint: firstDecision.candidateFingerprint, candidateFingerprintVersion: firstDecision.candidateFingerprintVersion });
			const secondProposal = { ...copyPublicationValue(secondRequest) as Record<string, unknown>, candidateFileMetadata: firstDecision.candidateFileMetadata, pointer: { ...firstDecision.pointer, assetRef: "project/" + pair.b.project._node_id + "/resource/" + resourceB._node_id + "/asset/replica-second-B", sourceRef: "handle:replica-second-B", url: "blob:playback:replica-second-B", width: 128, height: 72 }, updatedAt: 303 };
			const normalizedSecondProposal = publicationProposal(secondProposal)!;
			expect(normalizedSecondProposal).not.toBeNull();
			expect(normalizedSecondProposal.candidateMetadata).toEqual(secondMetadata);
			expect([normalizedSecondProposal.pointer.width, normalizedSecondProposal.pointer.height]).toEqual([128, 72]);
			const beforeSecond = await readAcceptedState(secondTask);
			expect(beforeSecond.taskValues[0]).toBe("committing");
			expect(beforeSecond.taskValues[2]).toBe(true);
			expect([null, undefined]).toContain(beforeSecond.taskValues[3]);
			expect([null, undefined]).toContain(beforeSecond.taskValues[4]);
			expect(beforeSecond.projectId).toBe(pair.b.project._node_id);
			expect(beforeSecond.taskResourceId).toBe(resourceB._node_id);
			expect(beforeSecond.activeTaskId).toBe(secondTask._node_id);
			expect(beforeSecond.taskState).toMatchObject({ taskId: secondTask._node_id, operationId: secondOperation, attemptId: "attempt:replica-second:B", bootId: "boot:replica-second:B", runtimeHandleId: "runtime:replica-second:B", phase: "committing", publicationRequested: true, candidateMetadata: secondMetadata, candidateFingerprint: firstDecision.candidateFingerprint, candidateFingerprintVersion: firstDecision.candidateFingerprintVersion });
			const secondCount = pair.b.effects.publicationDecisionCalls.length;
			await dispatchAndSettle(pair.b.ctx, secondTask, "completePublication", secondProposal);
			expect(pair.b.effects.publicationDecisionCalls).toHaveLength(secondCount + 1);
			const secondEnvelope = pair.b.effects.publicationDecisionCalls.at(-1)!;
			expect(secondEnvelope).toMatchObject({ bindingEligibility: "current", decision: { ...publicationTuple(secondProposal), kind: "accepted", sequence: 2, pointer: secondProposal.pointer, candidateFileMetadata: firstDecision.candidateFileMetadata, previousAcceptedIdentityAndRefs: { ...publicationTuple(firstDecision), sequence: 1, pointer: firstDecision.pointer } } });
			const secondDecision = acceptedPublication(secondEnvelope.decision)!;
			expect(secondDecision).not.toBeNull();
			expect(secondEnvelope.decision).toEqual(secondDecision);
			expect(secondDecision.candidateMetadata).toEqual(secondMetadata);
			expect([secondDecision.pointer.width, secondDecision.pointer.height, secondDecision.acceptedResource.width, secondDecision.acceptedResource.height]).toEqual([128, 72, 128, 72]);
			const afterSecond = await readAcceptedState(secondTask);
			const secondResourceValues = resourceFields.map((key, index) => key === "localPublicationSequence" ? 2 : key === "localAcceptedPublication" ? secondDecision : Object.hasOwn(secondDecision.pointer, key) ? secondDecision.pointer[key as keyof AcceptedPublication["pointer"]] : Object.hasOwn(secondDecision.candidateFileMetadata, key) ? secondDecision.candidateFileMetadata[key as keyof AcceptedPublication["candidateFileMetadata"]] : beforeSecond.resourceValues[index]);
			const secondTaskValues = taskFields.map((key, index) => key === "publicationReceipt" ? secondDecision : key === "stagedAssetRef" ? secondDecision.pointer.assetRef : key === "stagedHandleRef" ? secondDecision.pointer.sourceRef : beforeSecond.taskValues[index]);
			expect(secondResourceValues).toHaveLength(17);
			expect(afterSecond).toEqual({
				...beforeSecond, resourceValues: secondResourceValues, taskValues: secondTaskValues,
				taskState: { ...recordOf(beforeSecond.taskState), publicationReceipt: secondDecision, stagedAssetRef: secondDecision.pointer.assetRef, stagedHandleRef: secondDecision.pointer.sourceRef },
				transferSnapshot: { ...Object.fromEntries(Object.entries(recordOf(beforeSecond.transferSnapshot)!).map(([key, value]) => [key, Object.hasOwn(secondDecision.pointer, key) ? secondDecision.pointer[key as keyof AcceptedPublication["pointer"]] : Object.hasOwn(secondDecision.candidateFileMetadata, key) ? secondDecision.candidateFileMetadata[key as keyof AcceptedPublication["candidateFileMetadata"]] : value])), url: "", width: 128, height: 72 },
			});
			await pair.b.ctx.lockToRead(async () => {
				expect(await queryNativeManyAttrs(taskB as never, ["publicationReceipt", "phase"])).toEqual([firstDecision, "interrupted"]);
			});
			const secondState = await readAcceptedState();
			const secondTaskState = await readAcceptedState(secondTask);
			const oldReplayCount = pair.b.effects.publicationDecisionCalls.length;
			await dispatchAndSettle(pair.b.ctx, taskB, "completePublication", proposalB);
			expect(pair.b.effects.publicationDecisionCalls).toHaveLength(oldReplayCount + 1);
			expect(pair.b.effects.publicationDecisionCalls.at(-1)).toEqual({ decision: firstDecision, bindingEligibility: "obsolete" });
			expect(await readAcceptedState()).toEqual(secondState);
			expect(await readAcceptedState(secondTask)).toEqual(secondTaskState);
		} finally {
			pair.close();
		}
	});


	it("captures and admits an absent sequence on a real CRDT-created Resource", async () => {
		const pair = await createCrdtWorkerPair({ App: productionMiniCutAppRoot, roomId: "restore-sequence-presence-public-pair", profileId: "minicut-crdt-v1", profileVersion: 1 });
		try {
			const operationId = "operation:sequence-presence-import";
			await dispatchAndSettle(pair.a.ctx, pair.a.project, "importResource", {
				name: "sequence-presence.webm", kind: "video", url: "blob:sequence-presence-import", mime: "video/webm", duration: 4, size: 4, status: "ready",
				operationId, attemptId: "attempt:sequence-presence-import", bootId: "boot:sequence-presence-import", recoveryKind: "import", intent: "restore", runtimeHandleId: "runtime:sequence-presence-import",
				original: { kind: "video", duration: 4, streams: { videoStreams: 1, audioStreams: null } }, requiredSourceEnd: 4, createdAt: 1, updatedAt: 1,
			});
			let resourceA!: Harness["videoResource"];
			let taskA!: Harness["videoResource"];
			let metadata!: { kind: unknown; duration: unknown; width: null; height: null };
			await pair.a.ctx.lockToRead(async () => {
				const rawResources = await queryNativeRel(pair.a.project as never, "resources");
				const resources = (Array.isArray(rawResources) ? rawResources : rawResources == null ? [] : [rawResources]) as Harness["videoResource"][];
				expect(resources).toHaveLength(1);
				resourceA = resources[0]!;
				const rawTasks = await queryNativeRel(resourceA as never, "activeMediaRecoveryTask");
				const tasks = (Array.isArray(rawTasks) ? rawTasks : rawTasks == null ? [] : [rawTasks]) as Harness["videoResource"][];
				expect(tasks).toHaveLength(1);
				const [kind, duration] = await queryNativeManyAttrs(resourceA as never, ["kind", "duration"]);
				taskA = tasks[0]!;
				metadata = { kind, duration, width: null, height: null };
			});
			await dispatchAndSettle(pair.a.ctx, taskA, "recordInspection", { operationId, classification: "compatible-replacement", confirmationRequired: false, candidateMetadata: metadata, candidateFingerprint: "fp:sequence-presence", candidateFingerprintVersion: "sha256-v1", updatedAt: 101 });
			await dispatchAndSettle(pair.a.ctx, taskA, "requestCommit", { operationId, updatedAt: 102 });
			const commitRequest = pair.a.effects.mediaRecoveryCalls.at(-1)!;
			expect(commitRequest).toMatchObject({ mode: "commit", taskId: taskA._node_id, resourceId: resourceA._node_id, operationId });
			const pointer = { assetStorageKind: "project-copy", assetRef: "project/" + pair.a.project._node_id + "/resource/" + resourceA._node_id + "/asset/sequence-presence", sourceKind: "file-handle", sourceRef: "handle:sequence-presence", url: "blob:sequence-presence", contentFingerprint: "fp:sequence-presence", fingerprintVersion: "sha256-v1", duration: metadata.duration, width: null, height: null, localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted" };
			await dispatchAndSettle(pair.a.ctx, taskA, "completePublication", { ...commitRequest, candidateFileMetadata: { mime: "video/webm", size: 4, lastModified: 1 }, pointer, updatedAt: 103 });
			await pair.a.ctx.lockToRead(async () => {
				const [sequence, accepted] = await queryNativeManyAttrs(resourceA as never, ["localPublicationSequence", "localAcceptedPublication"]);
				expect(sequence).toBe(1);
				expect(accepted).toMatchObject({ kind: "accepted", sequence: 1, pointer });
			});
			expect(pair.a.effects.publicationDecisionCalls).toContainEqual(expect.objectContaining({ decision: expect.objectContaining({ kind: "accepted", sequence: 1, pointer }) }));
			pair.a.flushOutbound();
			await pair.waitForConvergence();
			pair.partition();
			let resourceB!: Harness["videoResource"];
			let captured!: Record<string, unknown>;
			await pair.b.ctx.lockToRead(async () => {
				const rawResources = await queryNativeRel(pair.b.project as never, "resources");
				const resources = (Array.isArray(rawResources) ? rawResources : rawResources == null ? [] : [rawResources]) as Harness["videoResource"][];
				resourceB = resources.find((resource) => resource._node_id === resourceA._node_id)!;
				expect(resourceB).toBeTruthy();
				const rawProject = await queryNativeRel(resourceB as never, "project");
				const project = (Array.isArray(rawProject) ? rawProject[0] : rawProject) as Harness["project"];
				const [assetStorageKind, assetRef, sourceKind, sourceRef, rawSequence] = await queryNativeManyAttrs(resourceB as never, ["assetStorageKind", "assetRef", "sourceKind", "sourceRef", "localPublicationSequence"]);
				expect(project._node_id).toBe(pair.a.project._node_id);
				expect({ assetStorageKind, assetRef, sourceKind, sourceRef }).toEqual({ assetStorageKind: pointer.assetStorageKind, assetRef: pointer.assetRef, sourceKind: pointer.sourceKind, sourceRef: pointer.sourceRef });
				expect(rawSequence).toBeUndefined();
				captured = { resourceId: resourceB._node_id, projectId: project._node_id, assetStorageKind, assetRef, sourceKind, sourceRef, handleRef: sourceRef };
			});
			const beforeCount = pair.b.effects.mediaRecoveryCalls.length;
			await dispatchAndSettle(pair.b.ctx, resourceB, "startMediaRecovery", attempt("boot:sequence-presence", "restore:sequence-presence"));
			expect(pair.b.effects.mediaRecoveryCalls).toHaveLength(beforeCount + 1);
			const request = pair.b.effects.mediaRecoveryCalls.at(-1)!;
			expect(request).toMatchObject({ resourceId: resourceB._node_id, projectId: pair.b.project._node_id, operationId: "restore:sequence-presence", bootId: "boot:sequence-presence", attemptId: "restore:sequence-presence:attempt" });
			expect(request.restoreSnapshot).toEqual({ ...captured, publicationSequencePresent: false, publicationSequence: null });
			expect(Object.keys(request.restoreSnapshot as object).sort()).toEqual(["resourceId", "projectId", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "handleRef", "publicationSequencePresent", "publicationSequence"].sort());
			expect(() => copyPublicationValue(request.restoreSnapshot)).not.toThrow();
			expect(copyPublicationValue(request.restoreSnapshot)).toEqual(request.restoreSnapshot);
			let taskB!: Harness["videoResource"];
			await pair.b.ctx.lockToRead(async () => {
				const rawTasks = await queryNativeRel(resourceB as never, "activeMediaRecoveryTask");
				const tasks = (Array.isArray(rawTasks) ? rawTasks : rawTasks == null ? [] : [rawTasks]) as Harness["videoResource"][];
				expect(tasks).toHaveLength(1);
				expect(tasks[0]!._node_id).toBe(request.taskId);
				taskB = tasks[0]!;
			});
			await dispatchAndSettle(pair.b.ctx, resourceB, "recordAutomaticMediaRecovery", { availability: "ready-project-copy", originalAccess: "granted", restoreSnapshot: request.restoreSnapshot, updatedAt: 201 });
			await pair.b.ctx.lockToRead(async () => {
				expect(await queryNativeManyAttrs(resourceB as never, ["localMediaAvailability", "originalAccessStatus", "localPublicationSequence"])).toEqual(["ready-project-copy", "granted", undefined]);
				const taskValues = await queryNativeManyAttrs(taskB as never, ["phase", "outcome", "publicationRequested", "publicationReceipt"]);
				expect(taskValues).toHaveLength(4);
				expect(taskValues.slice(0, 3)).toEqual(["completed", "completed", false]);
				expect([null, undefined]).toContain(taskValues[3]);
			});
			expect(pair.b.effects.publicationDecisionCalls).toEqual([]);
		} finally {
			pair.close();
		}
	});

	it("UNIT declaration functions distinguish sequence absence, zero, null, stale and legacy inputs", () => {
		type PureStep = { fn: readonly [readonly string[], (...args: unknown[]) => unknown] };
		type TaskDeclarations = { prototype: { __dcls_actions: { runRecoveryEffect: readonly [unknown, PureStep] } } };
		type ResourceDeclarations = { prototype: { __dcls_actions: { recordAutomaticMediaRecovery: readonly [PureStep, unknown] } } };
		const taskStep = (MediaRecoveryTask as unknown as TaskDeclarations).prototype.__dcls_actions.runRecoveryEffect[1];
		const resourceStep = (Resource as unknown as ResourceDeclarations).prototype.__dcls_actions.recordAutomaticMediaRecovery[0];
		expect(taskStep.fn[0]).toEqual(["$noop", "_node_id", "operationId", "bootId", "intent", "attemptId", "< @one:_node_id < resource.project", "< @one:_node_id < resource", "< @one:kind < resource", "< @one:duration < resource", "< @one:width < resource", "< @one:height < resource", "< @one:contentFingerprint < resource", "< @one:fingerprintVersion < resource", "< @one:requiredSourceEnd < resource", "< @one:sourceKind < resource", "< @one:sourceRef < resource", "< @one:assetStorageKind < resource", "< @one:assetRef < resource", "< @one:localPublicationSequence < resource"]);
		expect(resourceStep.fn[0]).toEqual(["$noop", "_node_id", "$meta$removed", "< @one:_node_id < project", "< @one:$meta$removed < project", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "localPublicationSequence", "localAcceptedPublication", "< @one:publicationState < activeMediaRecoveryTask", "url"]);
		const noop = Symbol("sequence-unit-noop");
		const backing = { resourceId: "resource:unit", projectId: "project:unit", assetStorageKind: "project-copy", assetRef: "asset:unit", sourceKind: "file-handle", sourceRef: "handle:unit", handleRef: "handle:unit" };
		const capture = (sequence: unknown) => {
			const output = taskStep.fn[1]({}, noop, "task:unit", "operation:unit", "boot:unit", "restore", "attempt:unit", backing.projectId, backing.resourceId, "video", 4, null, null, "fp:unit", "sha256-v1", 4, backing.sourceKind, backing.sourceRef, backing.assetStorageKind, backing.assetRef, sequence) as { restoreSnapshot: Record<string, unknown> };
			return output.restoreSnapshot;
		};
		const admit = (snapshot: Record<string, unknown>, current: unknown, removed = false, projectRemoved = false, taskValue: unknown = null) => {
			const payload = { availability: "ready-project-copy", originalAccess: "granted", restoreSnapshot: snapshot, updatedAt: 201 };
			const actual = resourceStep.fn[1](payload, noop, backing.resourceId, removed, backing.projectId, projectRemoved, backing.assetStorageKind, backing.assetRef, backing.sourceKind, backing.sourceRef, current, null, taskValue, "blob:unit-current");
			return { actual, expected: { url: "blob:unit-current", localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted", forwarded: payload } };
		};
		// Pure comparison rows do not assert public null/absent-to-number publication reachability.
		for (const captured of [undefined, 0, 1, null]) {
			const snapshot = capture(captured);
			expect(snapshot).toEqual({ ...backing, publicationSequencePresent: captured !== undefined, publicationSequence: captured === undefined ? null : captured });
			expect(copyPublicationValue(snapshot)).toEqual(snapshot);
			for (const current of [undefined, 0, 1, null]) {
				const { actual, expected } = admit(snapshot, current);
				if (captured === current) expect(actual).toEqual(expected);
				else expect(actual).toBe(noop);
			}
		}
		for (const present of ["sequence:serial", false]) {
			expect(capture(present)).toEqual({ ...backing, publicationSequencePresent: true, publicationSequence: present });
		}
		for (const invalid of [NaN, Infinity, -Infinity, Symbol("nonserial"), () => undefined, new Map()]) {
			expect(() => capture(invalid)).toThrow("Nonserial publication value");
		}
		for (const malformed of [undefined, null, 0, 1, "false", "true", {}, []]) {
			expect(admit({ ...capture(0), publicationSequencePresent: malformed }, 0).actual).toBe(noop);
		}
		const missingSequence = { ...capture(0) };
		delete missingSequence.publicationSequence;
		expect(admit(missingSequence, 0).actual).toBe(noop);
		expect(admit({ ...capture(undefined), publicationSequence: 0 }, undefined).actual).toBe(noop);
		expect(admit({ ...capture(undefined), publicationSequencePresent: true }, undefined).actual).toBe(noop);
		expect(admit({ ...capture(0), publicationSequencePresent: false }, 0).actual).toBe(noop);
		for (const legacySequence of [undefined, 0, 1, null]) {
			const legacy = { ...backing, publicationSequence: legacySequence };
			expect(Object.hasOwn(legacy, "publicationSequencePresent")).toBe(false);
			for (const current of [undefined, 0, 1, null]) {
				const { actual, expected } = admit(legacy, current);
				if (legacySequence === current) expect(actual).toEqual(expected);
				else expect(actual).toBe(noop);
			}
		}
		const inherited = Object.assign(Object.create({ publicationSequencePresent: "malformed-inherited" }), { ...backing, publicationSequence: 0 }) as Record<string, unknown>;
		expect(admit(inherited, 0).actual).toEqual(admit(inherited, 0).expected);
		for (const [removed, projectRemoved, taskValue] of [[true, false, null], [false, true, null], [false, false, { publicationRequested: true }], [false, false, { publicationReceipt: {} }]] as const) {
			expect(admit(capture(0), 0, removed, projectRemoved, taskValue).actual).toBe(noop);
		}
	});

	it("UNIT publication allocation distinguishes missing history from invalid or prior order", () => {
		// Internal declaration boundary only: malformed stored rows are not public reachability claims.
		type Step = { fn: readonly [readonly string[], (...args: unknown[]) => unknown] };
		type Declaration = { prototype: { __dcls_actions: { completeMediaRecovery: { steps: readonly Step[] } } } };
		const step = (Resource as unknown as Declaration).prototype.__dcls_actions.completeMediaRecovery.steps[0]!;
		expect(step.fn[0]).toEqual(["_node_id", "$meta$removed", "< @one:_node_id < project", "< @one:$meta$removed < project", "< @one:publicationState < activeMediaRecoveryTask", "localPublicationSequence", "localAcceptedPublication", "transferSnapshot"]);
		const pointer = { assetStorageKind: "project-copy", assetRef: "asset:allocation", sourceKind: "file-handle", sourceRef: "handle:allocation", url: "blob:allocation", contentFingerprint: "fp:allocation", fingerprintVersion: "sha256-v1", duration: 4, width: null, height: null, localMediaAvailability: "ready-project-copy", originalAccessStatus: "granted" };
		const proposal = publicationProposal({ projectId: "project:allocation", resourceId: "resource:allocation", taskId: "task:allocation", operationId: "op:allocation", attemptId: "attempt:allocation", bootId: "boot:allocation", runtimeHandleId: "runtime:allocation", candidateMetadata: { kind: "video", duration: 4, width: null, height: null }, candidateFingerprint: pointer.contentFingerprint, candidateFingerprintVersion: pointer.fingerprintVersion, candidateFileMetadata: { mime: "video/webm", size: 4, lastModified: 1 }, pointer, updatedAt: 103 })!;
		expect(proposal).not.toBeNull();
		const snapshot = { resourceId: proposal.resourceId, projectId: proposal.projectId, name: "allocation.webm", kind: "video", status: "ready", source: { kind: "local" }, data: { status: "ready" }, ...proposal.pointer, ...proposal.candidateFileMetadata };
		const task = { ...publicationTuple(proposal), candidateMetadata: proposal.candidateMetadata, candidateFingerprint: proposal.candidateFingerprint, candidateFingerprintVersion: proposal.candidateFingerprintVersion, publicationRequested: true, phase: "committing", removed: false, publicationReceipt: null };
		const prior = (sequence: number, resourceId = proposal.resourceId, projectId = proposal.projectId) => {
			const receipt = acceptedPublication({ ...proposal, resourceId, projectId, kind: "accepted", sequence, acceptedResource: { ...snapshot, resourceId, projectId }, previousAcceptedIdentityAndRefs: null })!;
			expect(receipt).not.toBeNull();
			return receipt;
		};
		const p1 = prior(1); const p2 = prior(2); const p5 = prior(5); const pMax = prior(Number.MAX_SAFE_INTEGER);
		const foreign = prior(1, "resource:foreign");
		const reparented = prior(1, proposal.resourceId, "project:old");
		type Options = { payload?: unknown; resourceId?: unknown; removed?: unknown; projectId?: unknown; projectRemoved?: unknown; task?: unknown; snapshot?: unknown };
		const invoke = (sequence: unknown, previous: unknown, options: Options = {}) => {
			const inputs = [options.payload ?? proposal, options.resourceId ?? proposal.resourceId, options.removed ?? false, options.projectId ?? proposal.projectId, options.projectRemoved ?? false, options.task ?? task, sequence, previous, options.snapshot ?? snapshot];
			const before = structuredClone(inputs);
			const result = step.fn[1](...inputs) as Record<string, unknown>;
			expect(inputs).toEqual(before);
			return result;
		};
		const accepted = (sequence: unknown, previous: unknown, next: number) => {
			const output = invoke(sequence, previous);
			const decision = acceptedPublication(recordOf(output.forwarded)?.decision)!;
			expect(decision).not.toBeNull();
			const expectedPrevious = previous == null ? null : { ...publicationTuple(previous), sequence: (previous as AcceptedPublication).sequence, pointer: (previous as AcceptedPublication).pointer };
			const expectedDecision = { ...proposal, kind: "accepted", sequence: next, acceptedResource: snapshot, previousAcceptedIdentityAndRefs: expectedPrevious };
			expect(decision).toEqual(expectedDecision);
			expect(output).toEqual({ ...proposal.pointer, ...proposal.candidateFileMetadata, localPublicationSequence: next, localAcceptedPublication: expectedDecision, forwarded: { decision: expectedDecision, bindingEligibility: "current" } });
		};
		const rejected = (sequence: unknown, previous: unknown, reason = "publication-sequence-overflow", disposition = "retain-uncertain", options: Options = {}) => {
			const output = invoke(sequence, previous, options);
			expect(output).toEqual({ forwarded: { ...publicationTuple(options.payload ?? proposal), kind: "rejected", reason, candidateDisposition: disposition } });
			for (const key of [...Object.keys(proposal.pointer), ...Object.keys(proposal.candidateFileMetadata), "localPublicationSequence", "localAcceptedPublication"]) expect(Object.hasOwn(output, key)).toBe(false);
		};
		for (const sequence of [undefined, null]) for (const previous of [undefined, null]) accepted(sequence, previous, 1);
		for (const sequence of [0, -0, 1, 5, Number.MAX_SAFE_INTEGER - 1]) accepted(sequence, null, sequence + 1);
		accepted(1, p1, 2); accepted(5, p1, 6); accepted(5, p5, 6); accepted(5, reparented, 6);
		for (const sequence of [Number.MAX_SAFE_INTEGER, -1, Number.MIN_SAFE_INTEGER, 1.5, "0", "1", "", true, false, {}, [], NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) rejected(sequence, null);
		rejected(Number.MAX_SAFE_INTEGER, pMax);
		for (const sequence of [undefined, null]) for (const previous of [p1, false, 0, "", {}, foreign]) rejected(sequence, previous);
		rejected(0, p2); rejected(1, p2);
		for (const sequence of [0, 1, 5]) for (const previous of [false, 0, "", {}, [], foreign]) rejected(sequence, previous);
		// A disjoint unaccepted candidate remains rollback-safe; same backing/prior uncertainty retains.
		rejected(-1, null, "publication-sequence-overflow", "rollback-unaccepted", { snapshot: { ...snapshot, assetRef: "asset:other", sourceRef: "handle:other" } });
		for (const sequence of [undefined, null, Number.MAX_SAFE_INTEGER]) {
			for (const previous of [p1, null]) {
				const output = invoke(sequence, previous, { task: { ...task, publicationReceipt: p1 } });
				expect(output).toEqual({ forwarded: { decision: p1, bindingEligibility: previous === p1 ? "current" : "obsolete" } });
			}
		}
		for (const options of [
			{ removed: true }, { projectRemoved: true }, { resourceId: "resource:wrong" }, { projectId: "project:wrong" },
			{ task: { ...task, removed: true } }, { task: { ...task, publicationRequested: false } }, { task: { ...task, phase: "inspecting" } },
			...["taskId", "operationId", "attemptId", "bootId", "runtimeHandleId", "candidateFingerprint", "candidateFingerprintVersion"].map((key) => ({ task: { ...task, [key]: "wrong:" + key } })),
			{ task: { ...task, candidateMetadata: { kind: "audio" } } },
		]) {
			// exactness is false for task/candidate mismatches; all cases retain current backing.
			rejected(undefined, null, "publication-not-current", "retain-uncertain", options);
		}
		for (const pointerChange of [{ contentFingerprint: "fp:wrong" }, { fingerprintVersion: "version:wrong" }, { duration: 5 }, { width: 1 }, { height: 1 }]) {
			rejected(undefined, null, "candidate-pointer-mismatch", "retain-uncertain", { payload: { ...proposal, pointer: { ...proposal.pointer, ...pointerChange } } });
		}
	});
	it("captures the actual accepted backing in a fresh restore request and admits native missing facts", async () => {
		const h = await createActionContractHarness(); const { proposal } = await publish(h);
		await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", attempt("boot:missing", "restore:missing"));
		const task = (await queryRel(h.videoResource, "activeMediaRecoveryTask"))[0]!;
		const request = h.mediaRecoveryRequests.at(-1) as Record<string, unknown>;
		expect(request.restoreSnapshot).toEqual({ resourceId: h.videoResource._node_id, projectId: h.project._node_id, assetStorageKind: "project-copy", assetRef: proposal.pointer.assetRef, sourceKind: "file-handle", sourceRef: proposal.pointer.sourceRef, handleRef: proposal.pointer.sourceRef, publicationSequencePresent: true, publicationSequence: 1 });
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "missing", restoreSnapshot: request.restoreSnapshot, updatedAt: 201 });
		expect(getAttr(h.videoResource, "localMediaAvailability")).toBe("unavailable");
		expect(getAttr(h.videoResource, "originalAccessStatus")).toBe("missing");
		expect(getAttr(task, "phase")).toBe("awaiting-user-action");
		expect(getAttr(task, "reasonCode")).toBe("source-missing");
	});
	it.each(["resourceId", "projectId", "assetStorageKind", "assetRef", "sourceKind", "sourceRef", "handleRef", "publicationSequence", "publicationSequencePresent"] as const)("rejects native missing facts with stale captured %s", async (field) => {
		const h = await createActionContractHarness(); await publish(h);
		await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", attempt("boot:missing", "restore:missing"));
		const task = (await queryRel(h.videoResource, "activeMediaRecoveryTask"))[0]!;
		const request = h.mediaRecoveryRequests.at(-1) as Record<string, unknown>;
		const snapshot = request.restoreSnapshot as Record<string, unknown>;
		expect(snapshot).toEqual(await captureRestoreSnapshot(h));
		const before = { ...capturePublicationState(h, task), reasonCode: getAttr(task, "reasonCode"), errorMessage: getAttr(task, "errorMessage"), updatedAt: getAttr(task, "updatedAt") };
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "missing", restoreSnapshot: { ...snapshot, [field]: field === "publicationSequencePresent" ? false : field === "publicationSequence" ? 0 : "stale:" + field }, updatedAt: 201 });
		expect({ ...capturePublicationState(h, task), reasonCode: getAttr(task, "reasonCode"), errorMessage: getAttr(task, "errorMessage"), updatedAt: getAttr(task, "updatedAt") }).toEqual(before);
	});
	it("rejects an actual emitted restore snapshot after a newer publication and admits the fresh one", async () => {
		const h = await createActionContractHarness(); await publish(h);
		await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", attempt("boot:old-restore", "restore:old"));
		const oldRequest = h.mediaRecoveryRequests.at(-1) as Record<string, unknown>;
		await publish(h, h.videoResource, "B");
		await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", attempt("boot:new-restore", "restore:new"));
		const task = (await queryRel(h.videoResource, "activeMediaRecoveryTask"))[0]!;
		const freshRequest = h.mediaRecoveryRequests.at(-1) as Record<string, unknown>;
		expect(freshRequest.restoreSnapshot).toEqual(await captureRestoreSnapshot(h));
		const before = capturePublicationState(h, task);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "missing", restoreSnapshot: oldRequest.restoreSnapshot, updatedAt: 201 });
		expect(capturePublicationState(h, task)).toEqual(before);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "missing", restoreSnapshot: freshRequest.restoreSnapshot, updatedAt: 202 });
		expect(getAttr(h.videoResource, "originalAccessStatus")).toBe("missing");
		expect(getAttr(task, "phase")).toBe("awaiting-user-action");
		expect(getAttr(task, "reasonCode")).toBe("source-missing");
	});
	it("admits matching legacy snapshots and rejects differing axes from an obsolete sequence", async () => {
		const h = await createActionContractHarness(); const snapshot = Object.fromEntries(Object.entries(await captureRestoreSnapshot(h)).filter(([key]) => key !== "publicationSequencePresent"));
		expect(Object.hasOwn(snapshot, "publicationSequencePresent")).toBe(false);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "ready-project-copy", originalAccess: "granted", restoreSnapshot: snapshot, updatedAt: 1 });
		expect(getAttr(h.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
		expect(getAttr(h.videoResource, "originalAccessStatus")).toBe("granted");
		const before = capturePublicationState(h);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", restoreSnapshot: { ...snapshot, publicationSequence: -1 }, updatedAt: 2 });
		expect(capturePublicationState(h)).toEqual(before);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", restoreSnapshot: { ...snapshot, assetRef: "obsolete-ref" }, updatedAt: 3 });
		expect(capturePublicationState(h)).toEqual(before);
		await dispatchAndSettle(h.ctx, h.videoResource, "setResourceAttrs", {
			...(getAttr(h.videoResource, "transferSnapshot") as object), assetStorageKind: "project-copy",
			assetRef: "project/" + h.project._node_id + "/resource/" + h.videoResource._node_id + "/asset/C",
			sourceKind: "file-handle", sourceRef: "handle:current-C",
		});
		const afterPointerChange = capturePublicationState(h);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", restoreSnapshot: snapshot, updatedAt: 4 });
		expect(capturePublicationState(h)).toEqual(afterPointerChange);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "invalid", originalAccess: "invalid", updatedAt: 4 });
		expect(capturePublicationState(h)).toEqual(afterPointerChange);
		await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { availability: "unavailable", originalAccess: "denied", updatedAt: 5 });
		expect(getAttr(h.videoResource, "localMediaAvailability")).toBe("unavailable");
		expect(getAttr(h.videoResource, "originalAccessStatus")).toBe("denied");
	});
	it("protects both actual refs when axes invalidate a publication, and protects a reused ref independently", async () => {
		const h = await createActionContractHarness(); const { proposal } = await publish(h);
		const originalAccepted = await queryAttr(h.videoResource, "localAcceptedPublication");
		expect(originalAccepted).not.toBeNull();
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, h.videoResource, "setLocalMediaAxes", { availability: "unavailable", originalAccess: "denied" });
		expect(getAttr(h.videoResource, "assetRef")).toBe(proposal.pointer.assetRef);
		expect(getAttr(h.videoResource, "sourceRef")).toBe(proposal.pointer.sourceRef);
		const acceptedAfterAxes = await queryAttr(h.videoResource, "localAcceptedPublication");
		const validityAfterAxes = await queryAttr(h.videoResource, "localPublicationValidity");
		await h.ctx.lockToRead(async () => {
			logPublicationDiagnostic("axes-before-root-accepted-assertion:start", {});
			const rawRootProjects = await queryNativeRel(h.ctx.appModel as never, "project");
			const rootProjects = rawRootProjects == null ? [] : Array.isArray(rawRootProjects) ? rawRootProjects : [rawRootProjects];
			const rawProjectResources = await queryNativeRel(h.project as never, "resources");
			const projectResources = rawProjectResources == null ? [] : Array.isArray(rawProjectResources) ? rawProjectResources : [rawProjectResources];
			const rawResourceProjects = await queryNativeRel(h.videoResource as never, "project");
			const resourceProjects = rawResourceProjects == null ? [] : Array.isArray(rawResourceProjects) ? rawResourceProjects : [rawResourceProjects];
			const rawDirectRootedResources = await queryNativeAddr(h.ctx.appModel as never, diagnosticAddr({ relPath: ["project", "resources"], zip: "all" }));
			const directRootedResources = rawDirectRootedResources == null ? [] : Array.isArray(rawDirectRootedResources) ? rawDirectRootedResources : [rawDirectRootedResources];
			const rawResources = await queryNativeRel(h.ctx.appModel as never, "resource");
			const rootResources = rawResources == null ? [] : Array.isArray(rawResources) ? rawResources : [rawResources];
			const aggregate = await queryNativeAddr(h.ctx.appModel as never, "< @all:localPublicationValidity < resource");
			const [manifest] = await queryNativeManyAttrs(h.ctx.appModel as never, ["localMediaPublicationManifest"]);
			logPublicationDiagnostic("axes-before-root-accepted-assertion", {
				testedProjectId: h.project._node_id, testedResourceId: h.videoResource._node_id,
				rawRootProjectIds: rootProjects.map((project) => (project as { _node_id?: unknown })._node_id),
				rawProjectResourceIds: projectResources.map((resource) => (resource as { _node_id?: unknown })._node_id),
				rawResourceProjectIds: resourceProjects.map((project) => (project as { _node_id?: unknown })._node_id),
				directRootedResourceIds: directRootedResources.map((resource) => (resource as { _node_id?: unknown })._node_id),
				rootResourceIds: rootResources.map((resource) => (resource as { _node_id?: unknown })._node_id),
				aggregateIsArray: Array.isArray(aggregate), aggregateType: typeof aggregate, aggregate, manifest,
			});
		});
		const manifestAfterAxes = await queryAttr(h.ctx.appModel, "localMediaPublicationManifest") as PublicationManifest;
		expect(acceptedAfterAxes).toEqual(originalAccepted);
		expect(validityAfterAxes).not.toBeNull();
		expect(validityAfterAxes).toMatchObject({ accepted: originalAccepted, eligible: false, currentBacking: { projectId: h.project._node_id, assetRef: proposal.pointer.assetRef, handleRef: proposal.pointer.sourceRef } });
		expect(manifestAfterAxes).not.toBeNull();
		expect(manifestAfterAxes.accepted[0]).toMatchObject({ accepted: originalAccepted, eligible: false, currentBacking: { projectId: h.project._node_id, assetRef: proposal.pointer.assetRef, handleRef: proposal.pointer.sourceRef } });
		expect(h.publicationRetirements).toEqual([expect.objectContaining({ resourceId: h.videoResource._node_id, sequence: 1, excludedAssetRef: proposal.pointer.assetRef, excludedHandleRef: proposal.pointer.sourceRef })]);
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, h.videoResource, "setResourceAttrs", { ...(getAttr(h.videoResource, "transferSnapshot") as object), ...proposal.pointer, ...proposal.candidateFileMetadata, sourceRef: "handle:new-current" });
		const acceptedAfterRef = await queryAttr(h.videoResource, "localAcceptedPublication");
		const validityAfterRef = await queryAttr(h.videoResource, "localPublicationValidity");
		const manifestAfterRef = await queryAttr(h.ctx.appModel, "localMediaPublicationManifest") as PublicationManifest;
		expect(acceptedAfterRef).toEqual(originalAccepted);
		expect(validityAfterRef).not.toBeNull();
		expect(validityAfterRef).toMatchObject({ accepted: originalAccepted, eligible: false, currentBacking: { assetRef: proposal.pointer.assetRef, handleRef: "handle:new-current" } });
		expect(manifestAfterRef).not.toBeNull();
		expect(manifestAfterRef.accepted[0]).toMatchObject({ accepted: originalAccepted, eligible: false, currentBacking: { assetRef: proposal.pointer.assetRef, handleRef: "handle:new-current" } });
		expect(h.publicationRetirements).toEqual([expect.objectContaining({ assetRef: proposal.pointer.assetRef, handleRef: proposal.pointer.sourceRef, excludedAssetRef: proposal.pointer.assetRef, excludedHandleRef: "handle:new-current" })]);
	});
});

describe("Root physical publication deletion", () => {
	it("retires the copied original once after native Resource unavailability while Root survives", async () => {
		let membersAfterDelete: readonly unknown[] = [];
		const h = await createActionContractHarness();
		const root = h.ctx.appModel; const rootId = root._node_id;
		if (typeof rootId !== "string") throw new Error("Expected live Root id");
		const rootProjects = Object.freeze(await queryRel(root, "project"));
		expect(rootProjects).toContain(h.project);
		expect(rootProjects.find((project) => project._node_id === h.project._node_id)).toBe(h.project);
		const before = await queryRel(h.project, "resources");
		await dispatchAndSettle(h.ctx, h.project, "importResource", {
			name: "no-clip-physical.webm", kind: "video", url: "blob:import", mime: "video/webm", duration: 4, size: 4,
			operationId: "op:physical-import", attemptId: "attempt:physical-import", bootId: "boot:physical", runtimeHandleId: "runtime:physical",
			recoveryKind: "import", intent: "restore", createdAt: 1, updatedAt: 1,
		});
		const beforeMembers = Object.freeze(await queryRel(h.project, "resources"));
		const imported = beforeMembers.find((resource) => !before.some((old) => old._node_id === resource._node_id))!;
		expect(imported).toBeTruthy(); expect(await queryRel(imported, "clips")).toEqual([]);
		const deletedId = imported._node_id;
		if (typeof deletedId !== "string") throw new Error("Expected imported Resource id");
		const importTasks = await queryRel(imported, "activeMediaRecoveryTask");
		expect(importTasks).toHaveLength(1);
		const importTaskId = importTasks[0]!._node_id;
		expect(typeof importTaskId).toBe("string");
		const { task: acceptedTask } = await publish(h, imported, "physical");
		const original = copyPublicationValue(owned(h).accepted.find((entry) => entry.resourceId === deletedId)) as PublicationManifest["accepted"][number];
		expect(original.eligible).toBe(true); expect(original.accepted).not.toBeNull();
		expect(original.taskId).toBe(acceptedTask._node_id);
		expect(original.taskId).not.toBe(importTaskId);
		expect(publicationTuple(original)).toEqual({
			projectId: h.project._node_id, resourceId: deletedId,
			taskId: acceptedTask._node_id, operationId: "op:physical",
			attemptId: "op:physical:attempt", bootId: "boot:physical",
			runtimeHandleId: "runtime:physical",
		});
		const importOwnership = {
			projectId: h.project._node_id, resourceId: deletedId, taskId: importTaskId,
			operationId: "op:physical-import", attemptId: "attempt:physical-import",
			bootId: "boot:physical", runtimeHandleId: "runtime:physical",
			accepted: null, pointer: null, assetRef: null, handleRef: null, eligible: false,
		};
		expect(owned(h).accepted.filter(x => x.resourceId === deletedId)).toEqual([original]);
		expect(owned(h).candidates.filter(x => x.resourceId === deletedId)).toEqual([importOwnership]);
		membersAfterDelete = Object.freeze(beforeMembers.filter((resource) => resource._node_id !== deletedId));
		h.publicationRetirements.length = 0;
		await dispatchAndSettle(h.ctx, root, "physicalDeletePublished", { resource: imported, project: h.project, membersAfterDelete });
		await h.ctx.lockToRead(() => {
			expect(getModelById(root as never, rootId)).toBe(root);
			expect(getModelById(root as never, deletedId)).toBeNull();
		});
		expect(await h.ctx.queryAttr(root, "_node_id")).toBe(rootId);
		expect(await queryRel(root, "project")).toEqual(rootProjects);
		expect((await queryRel(h.project, "resources")).map((resource) => resource._node_id)).toEqual(membersAfterDelete.map((resource) => (resource as Harness["videoResource"])._node_id));
		expect(owned(h).accepted.some((entry) => entry.resourceId === deletedId)).toBe(false);
		expect(owned(h).candidates.some((entry) => entry.resourceId === deletedId)).toBe(false);
		const token = publicationIdentity(original, original.accepted!.sequence);
		const expectedOriginalRetirement = {
			...original, sequence: original.accepted!.sequence,
			releaseTransferToken: token, releasePlaybackToken: token,
			disposition: "no-longer-current", reason: "publication-no-longer-owned",
			excludedAssetRef: null, excludedHandleRef: null,
		};
		const expectedImportRetirement = {
			...importOwnership, sequence: null,
			releaseTransferToken: null, releasePlaybackToken: null,
			disposition: "unaccepted", reason: "publication-no-longer-owned",
			excludedAssetRef: null, excludedHandleRef: null,
		};
		const forTask = (taskId: unknown) => h.publicationRetirements.filter(
			x => (x as { taskId?: unknown }).taskId === taskId,
		);
		expect(forTask(original.taskId)).toEqual([expectedOriginalRetirement]);
		expect(forTask(importTaskId)).toEqual([expectedImportRetirement]);
		expect(h.publicationRetirements).toHaveLength(2);
	});
});


describe("public automatic restore binds the current payload and playback capability", () => {
	it.each([1, 2].flatMap((sequence) => (["granted", "prompt", "denied"] as const).map((permission) => ({ sequence, permission }))))("restores sequence $sequence with $permission original access", async ({ sequence, permission }) => {
		const h = await createActionContractHarness();
		for (let index = 1; index <= sequence; index += 1) await publish(h, h.videoResource, "reload:" + index);
		const oldUrl = await queryAttr(h.videoResource, "url");
		await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", attempt("boot:reload", "restore:reload"));
		const request = h.mediaRecoveryRequests.at(-1) as { taskId: string; resourceId: string; bootId: string; attemptId: string; restoreSnapshot: LocalMediaResourceSnapshot };
		expect(request.restoreSnapshot).toMatchObject({ resourceId: h.videoResource._node_id, publicationSequencePresent: true, publicationSequence: sequence });
		const task = (await queryRel(h.videoResource, "activeMediaRecoveryTask"))[0]!;
		expect(task._node_id).toBe(request.taskId);
		const inputs: Record<string, unknown>[] = [];
		const file = new File(["current durable bytes"], "reload.webm", { type: "video/webm" });
		const urls: string[] = [];
		const resolver = createLocalMediaResolver({
			handleStore: { get: async () => null, getByRef: async () => ({ handle: { queryPermission: async () => permission } }) as never },
			projectAssets: { getFileByRef: async () => file } as never,
			runtime: {
				createObjectUrl: (blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; },
				revokeObjectUrl: (url) => URL.revokeObjectURL(url),
				setLocalMediaAxes: (_id, state, restoreSnapshot) => { inputs.push({ ...state, restoreSnapshot, updatedAt: 201 }); },
			},
		});
		try {
			const freshUrl = await resolver.restoreResource({ ...request.restoreSnapshot, bootId: request.bootId, attemptId: request.attemptId });
			expect(freshUrl).toEqual(expect.stringMatching(/^blob:/));
			expect(freshUrl).not.toBe(oldUrl);
			// Effect completion returns as later declared inputs, never synchronously inside an effect fake.
			for (const input of inputs) await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", input);
			expect(await queryAttr(h.videoResource, "url")).toBe(freshUrl);
			expect(await queryAttr(h.videoResource, "originalAccessStatus")).toBe(permission);
			expect(await queryAttr(h.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
			expect(await queryAttr(task, "phase")).toBe("completed");
			expect(await queryAttr(task, "outcome")).toBe("completed");
			expect(await (await fetch(freshUrl!)).text()).toBe("current durable bytes");
			const noUrl = { availability: "ready-project-copy", originalAccess: permission, restoreSnapshot: request.restoreSnapshot, updatedAt: 202 };
			await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", noUrl);
			expect(await queryAttr(h.videoResource, "url")).toBe(freshUrl);
			const beforeInvalid = capturePublicationState(h, task);
			for (const url of [undefined, null, "", "https://example.invalid/media", "blob:"]) {
				await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { ...noUrl, url });
				expect(capturePublicationState(h, task)).toEqual(beforeInvalid);
			}
			await publish(h, h.videoResource, "winning-publication");
			await dispatchAndSettle(h.ctx, h.videoResource, "startMediaRecovery", attempt("boot:next", "restore:next"));
			const currentTask = (await queryRel(h.videoResource, "activeMediaRecoveryTask"))[0]!;
			const beforeLate = capturePublicationState(h, currentTask);
			await dispatchAndSettle(h.ctx, h.videoResource, "recordAutomaticMediaRecovery", { ...inputs.at(-1), url: freshUrl });
			expect(capturePublicationState(h, currentTask)).toEqual(beforeLate);
			// The resolver's existing publication lease prevents late restore work from revoking a winner.
			const winningUrl = URL.createObjectURL(new Blob(["winning bytes"])); urls.push(winningUrl);
			resolver.activateObjectUrl(request.resourceId, winningUrl, "ready-project-copy", "winning-publication");
			expect(await resolver.restoreResource({ ...request.restoreSnapshot, bootId: "late" })).toBe(winningUrl);
			expect(await (await fetch(winningUrl)).text()).toBe("winning bytes");
		} finally {
			resolver.destroy();
			for (const url of urls) URL.revokeObjectURL(url);
		}
	});
});

// The model is native; the small physical store is a host-boundary fake, not graph state.
// The existing whole browser interrupted-commit case covers real OPFS reclamation.
describe("public prior-runtime accepted retirement reclaims only exact obsolete backing", () => {
	it("consumes actual captured model retirements without a previous host capability", async () => {
		const h = await createActionContractHarness();
		const { proposal: a } = await publish(h, h.videoResource, "prior-host:A");
		const files = new Map<string, File>([[a.pointer.assetRef!, new File(["A durable bytes"], "a.webm")]]);
		const handles = new Set([a.pointer.sourceRef!]);
		const consumer = createMediaPublicationConsumer({
			installTransfer() { throw new Error("A retired prior-host publication cannot install"); },
			installPlayback() { throw new Error("A retired prior-host publication cannot install"); },
			release(record, event) {
				const pointer = record.proposal!.pointer;
				if (pointer.assetRef && pointer.assetRef !== event.excludedAssetRef) files.delete(pointer.assetRef);
				if (pointer.sourceKind === "file-handle" && pointer.sourceRef && pointer.sourceRef !== event.excludedHandleRef) handles.delete(pointer.sourceRef);
			},
			reject() { throw new Error("No unaccepted prior-host candidate is authorized"); },
			result() {}, now: () => 201,
		});
		try {
			h.publicationRetirements.length = 0;
			await dispatchAndSettle(h.ctx, h.videoResource, "setLocalMediaAxes", { availability: "unavailable", originalAccess: "denied" });
			expect(h.publicationRetirements).toHaveLength(1);
			for (const event of h.publicationRetirements) consumer.consumeRetirement(event);
			expect(await files.get(a.pointer.assetRef!)!.text()).toBe("A durable bytes");
			expect(handles.has(a.pointer.sourceRef!)).toBe(true);

			h.publicationRetirements.length = 0;
			const current = await queryAttr(h.videoResource, "transferSnapshot") as object;
			await dispatchAndSettle(h.ctx, h.videoResource, "setResourceAttrs", { ...current, ...a.pointer, ...a.candidateFileMetadata, sourceRef: "handle:independent-current" });
			expect(h.publicationRetirements).toHaveLength(1);
			for (const event of h.publicationRetirements) consumer.consumeRetirement(event);
			expect(await files.get(a.pointer.assetRef!)!.text()).toBe("A durable bytes");
			expect(handles.has(a.pointer.sourceRef!)).toBe(false);

			h.publicationRetirements.length = 0;
			const { proposal: b } = await publish(h, h.videoResource, "current-host:B");
			files.set(b.pointer.assetRef!, new File(["B durable bytes"], "b.webm")); handles.add(b.pointer.sourceRef!);
			expect(h.publicationRetirements.length).toBeGreaterThan(0);
			for (const event of h.publicationRetirements) { consumer.consumeRetirement(event); consumer.consumeRetirement(event); }
			expect(files.has(a.pointer.assetRef!)).toBe(false);
			expect(files.size).toBe(1);
			expect(await files.get(b.pointer.assetRef!)!.text()).toBe("B durable bytes");
			expect(handles.has(b.pointer.sourceRef!)).toBe(true);
		} finally { consumer.dispose(); }
	});
});