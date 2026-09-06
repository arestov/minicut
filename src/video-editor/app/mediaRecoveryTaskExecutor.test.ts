import { describe, expect, it, vi } from "vitest";
import { executeMediaRecoveryInspectionTask } from "./mediaRecoveryTaskExecutor";

const request = {
	taskId: "task:1",
	resourceId: "resource:1",
	operationId: "operation:1",
	bootId: "boot:1",
	intent: "replace-source" as const,
	runtimeHandleId: "runtime:1",
	original: { kind: "video" as const, duration: 10, width: 1920, height: 1080, streams: { videoStreams: 1, audioStreams: 1 } },
	originalFingerprint: "old",
	fingerprintVersion: "sha256-v1",
	requiredSourceEnd: 8,
};

describe("media recovery task effect executor", () => {
	it("returns serializable inspection data through the scoped task action", async () => {
		const dispatch = vi.fn();
		const outcome = await executeMediaRecoveryInspectionTask({
			request,
			consumeRuntimeRef: () => ({ file: new File(["candidate"], "candidate.webm") }),
			probe: async () => ({ ...request.original }),
			fingerprint: async () => ({ fingerprint: "different", version: "sha256-v1" }),
			dispatch,
			now: () => 123,
		});
		expect(outcome?.policy.classification).toBe("compatible-replacement");
		expect(dispatch).toHaveBeenCalledWith("recordInspection", expect.objectContaining({ operationId: "operation:1", confirmationRequired: true }), { kind: "scope", _nodeId: "task:1" });
	});

	it("reports structured failures without mutating Resource", async () => {
		const dispatch = vi.fn();
		await executeMediaRecoveryInspectionTask({ request, consumeRuntimeRef: () => null, probe: vi.fn(), fingerprint: vi.fn(), dispatch, now: () => 5 });
		expect(dispatch).toHaveBeenCalledOnce();
		expect(dispatch).toHaveBeenCalledWith("transition", expect.objectContaining({ phase: "failed", reasonCode: "runtime-ref-expired" }), { kind: "scope", _nodeId: "task:1" });
	});

	it("drops a cancelled result instead of publishing it", async () => {
		const dispatch = vi.fn();
		await executeMediaRecoveryInspectionTask({ request, consumeRuntimeRef: () => ({ file: new File(["candidate"], "candidate.webm") }), probe: async () => ({ ...request.original }), fingerprint: vi.fn(), dispatch, now: () => 1, isCancelled: () => true });
		expect(dispatch).not.toHaveBeenCalled();
	});
});
