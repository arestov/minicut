import { describe, expect, it } from "vitest";
import { bootDktModels } from "../testingInit";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { createMiniCutCrdtStorageProfiles } from "../test/crdtStorageMatrix";

describe("MiniCut CRDT storage profiles", () => {
	for (const profile of createMiniCutCrdtStorageProfiles()) {
		it(`persists local project edits with ${profile.name}`, async () => {
			const ctx = await bootDktModels({
				unloadModels: profile.unloadModels,
				crdt: {
					enabled: true,
					peerId: `profile-${profile.name}`,
					storage: profile.storage,
					transport: null,
				},
			});

			await ctx.lockToRead(async () => {
				await ctx.sessionRoot.dispatch("createProject", {
					title: `Profile project ${profile.name}`,
				});
			});
			drainCrdtOutbox(ctx.runtime);

			const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
			if (!project) {
				throw new Error("Expected active project");
			}

			await ctx.lockToRead(async () => {
				await project.dispatch("renameProject", `Renamed ${profile.name}`);
			});

			const ops = drainCrdtOutbox(ctx.runtime);
			expect(ctx.getAttr(project, "title")).toBe(`Renamed ${profile.name}`);
			expect(ops).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: "attr",
						name: "title",
						value: `Renamed ${profile.name}`,
					}),
				]),
			);

			await ctx.close();
		});
	}
});
