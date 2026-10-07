import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createActionContractHarness,
	dispatchAndSettle,
} from "./action-contract-test-harness";

const NOW = 1_700_000_000_123;

describe("SessionRoot time dependencies ($now)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("createProject takes createdAt/updatedAt from the $now-provided value", async () => {
		const harness = await createActionContractHarness();
		vi.spyOn(Date, "now").mockReturnValue(NOW);

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "createProject", {
			title: "Timed Project",
		});

		const activeProject = (
			await harness.ctx.queryRel(harness.sessionRoot, "activeProject")
		)[0];
		if (!activeProject) {
			throw new Error("Expected active project");
		}
		expect(harness.ctx.getAttr(activeProject, "title")).toBe("Timed Project");
		expect(harness.ctx.getAttr(activeProject, "createdAt")).toBe(NOW);
		expect(harness.ctx.getAttr(activeProject, "updatedAt")).toBe(NOW);
	});

	it("requestProjectExport stamps requestedAt/updatedAt from $now", async () => {
		const harness = await createActionContractHarness();
		vi.spyOn(Date, "now").mockReturnValue(NOW);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"requestProjectExport",
			{ id: "export:test:1" },
		);

		expect(
			harness.ctx.getAttr(harness.sessionRoot, "exportRequest"),
		).toMatchObject({ id: "export:test:1", requestedAt: NOW });
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "exportProgress"),
		).toMatchObject({ id: "export:test:1", stage: "queued", updatedAt: NOW });
	});

	it("requestProjectExport without a boundary-supplied id is a noop", async () => {
		const harness = await createActionContractHarness();
		const before = harness.exportRequests.length;

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"requestProjectExport",
			{},
		);

		expect(harness.exportRequests).toHaveLength(before);
		expect(
			harness.ctx.getAttr(harness.sessionRoot, "exportRequest") ?? null,
		).toBeNull();
	});

	it("setExportProgress defaults updatedAt from $now", async () => {
		const harness = await createActionContractHarness();
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"requestProjectExport",
			{ id: "export:test:2", range: { type: "project" } },
		);
		vi.spyOn(Date, "now").mockReturnValue(NOW + 1000);

		await dispatchAndSettle(
			harness.ctx,
			harness.sessionRoot,
			"setExportProgress",
			{ id: "export:test:2", range: { type: "project" }, stage: "rendering" },
		);

		expect(
			harness.ctx.getAttr(harness.sessionRoot, "exportProgress"),
		).toMatchObject({ id: "export:test:2", updatedAt: NOW + 1000 });
	});
});
