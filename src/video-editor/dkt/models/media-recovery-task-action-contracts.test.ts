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

	it("enforces transitions and atomically publishes only the current operation", async () => {
		const harness = await createActionContractHarness();
		await dispatchAndSettle(harness.ctx, harness.videoResource, "startMediaRecovery", attempt("boot:1", "operation:1"));
		const task = (await queryRel(harness.videoResource, "activeMediaRecoveryTask"))[0]!;

		await dispatchAndSettle(harness.ctx, task, "transition", { operationId: "operation:1", phase: "completed", updatedAt: 101 });
		expect(getAttr(task, "phase")).toBe("created");

		for (const phase of ["inspecting", "ready-to-commit", "committing"] as const) {
			await dispatchAndSettle(harness.ctx, task, "transition", { operationId: "operation:1", phase, updatedAt: 102 });
			expect(getAttr(task, "phase")).toBe(phase);
		}

		await dispatchAndSettle(harness.ctx, harness.videoResource, "completeMediaRecovery", {
			operationId: "stale",
			assetStorageKind: "project-copy",
			assetRef: "stale-asset",
			localMediaAvailability: "ready-project-copy",
			originalAccessStatus: "granted",
		});
		expect(getAttr(harness.videoResource, "assetRef")).not.toBe("stale-asset");
		expect(getAttr(task, "phase")).toBe("committing");

		await dispatchAndSettle(harness.ctx, harness.videoResource, "completeMediaRecovery", {
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
		});

		expect(getAttr(harness.videoResource, "assetRef")).toContain("operation:1");
		expect(getAttr(harness.videoResource, "localMediaAvailability")).toBe("ready-project-copy");
		expect(getAttr(harness.videoResource, "originalAccessStatus")).toBe("granted");
		expect(getAttr(task, "phase")).toBe("completed");
		expect(getAttr(task, "outcome")).toBe("completed");
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
