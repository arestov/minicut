import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createActionContractHarness,
	dispatchAndSettle,
} from "./action-contract-test-harness";

describe("Resource time dependencies ($now)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("requestAddToTimeline takes requestedAt from $now", async () => {
		const harness = await createActionContractHarness();
		vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_456);

		await dispatchAndSettle(
			harness.ctx,
			harness.videoResource,
			"requestAddToTimeline",
			{ resourceId: String(harness.videoResource._node_id) },
		);

		expect(
			harness.ctx.getAttr(harness.videoResource, "timelineAddRequest"),
		).toMatchObject({
			resourceId: String(harness.videoResource._node_id),
			requestedAt: 1_700_000_000_456,
		});
	});
});
