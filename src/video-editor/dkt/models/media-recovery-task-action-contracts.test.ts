import { describe, expect, it } from "vitest";
import { MediaRecoveryTask } from "../../models/MediaRecoveryTask";
import { createActionContractHarness, dispatchAndSettle } from "./action-contract-test-harness";
import { getAttr, queryRel } from "../testingInit";

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

		for (const phase of ["ready-to-commit", "committing"] as const) {
			await dispatchAndSettle(harness.ctx, task, "transition", { operationId: "operation:1", phase, updatedAt: 102 });
			expect(getAttr(task, "phase")).toBe(phase);
		}

		await dispatchAndSettle(harness.ctx, task, "completePublication", {
			operationId: "stale",
			assetStorageKind: "project-copy",
			assetRef: "stale-asset",
			localMediaAvailability: "ready-project-copy",
			originalAccessStatus: "granted",
		});
		expect(getAttr(harness.videoResource, "assetRef")).not.toBe("stale-asset");
		expect(getAttr(task, "phase")).toBe("committing");

		const completion = {
			operationId: "operation:1",
			assetStorageKind: "project-copy",
			assetRef: "project/project:1/resource/resource:1/asset/operation:1",
			sourceKind: "file-handle",
			sourceRef: "handle:operation:1",
			url: "blob:operation:1",
			contentFingerprint: "sha256:abc",
			fingerprintVersion: "sha256-v1",
			duration: 10,
			width: 1920,
			height: 1080,
			localMediaAvailability: "ready-project-copy",
			originalAccessStatus: "granted",
			updatedAt: 103,
		};
		await dispatchAndSettle(harness.ctx, harness.videoResource, "completeMediaRecovery", completion);
		await dispatchAndSettle(harness.ctx, task, "completePublication", completion);

		expect(getAttr(harness.videoResource, "assetRef")).toContain("operation:1");
		expect(getAttr(harness.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
		expect(getAttr(harness.videoResource, "originalAccessStatus")).toBe("granted");
		expect(getAttr(task, "phase")).toBe("completed");
		expect(getAttr(task, "outcome")).toBe("completed");
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
