import { describe, expect, it } from "vitest";
import { bootDktModels } from "../testingInit";
import { removeSessionRoot } from "./sessionPool";

describe("app sessions pool", () => {
	it("holds the booted session root and drops it when the session is closed", async () => {
		const ctx = await bootDktModels({});
		const ids = async () =>
			(await ctx.queryRel(ctx.appModel, "sessions")).map((item) => item._node_id);
		expect(await ids()).toEqual([ctx.sessionRoot._node_id]);

		await ctx.lockToRead(async () => {
			await removeSessionRoot(ctx.appModel as never, ctx.sessionRoot as never);
		});
		expect(await ids()).toEqual([]);
	});
});
