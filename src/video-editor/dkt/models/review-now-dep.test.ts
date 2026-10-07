import { afterEach, describe, expect, it, vi } from "vitest";
import { clipTimingConflictFixture } from "../review/testHarness/fixtures/clipTimingConflict";
import { bootDktModels } from "../testingInit";

const NOW = 1_700_000_000_789;

describe("Review time dependencies ($now)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handleCRDTConflict stamps session and item times from $now, selectReviewItem updates updatedAt from $now", async () => {
		const ctx = await bootDktModels();
		try {
			vi.spyOn(Date, "now").mockReturnValue(NOW);
			await ctx.lockToRead(async () => {
				await ctx.appModel.dispatch("handleCRDTConflict", {
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [],
					resolved: [],
				});
			});

			const session = (await ctx.queryRel(ctx.appModel, "reviewSession"))[0];
			const item = (await ctx.queryRel(ctx.appModel, "reviewItem"))[0];
			if (!session || !item) {
				throw new Error("Expected review session and item");
			}
			expect(ctx.getAttr(session, "openedAt")).toBe(NOW);
			expect(ctx.getAttr(session, "updatedAt")).toBe(NOW);
			expect(ctx.getAttr(item, "createdAt")).toBe(NOW);
			expect(ctx.getAttr(item, "updatedAt")).toBe(NOW);

			vi.spyOn(Date, "now").mockReturnValue(NOW + 1000);
			await ctx.lockToRead(async () => {
				await session.dispatch("selectReviewItem", {
					reviewItemId: String(ctx.getAttr(item, "reviewItemId")),
				});
			});
			expect(ctx.getAttr(session, "updatedAt")).toBe(NOW + 1000);
		} finally {
			await ctx.close();
		}
	});
});
