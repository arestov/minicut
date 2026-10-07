import { hookSessionRoot } from "dkt-all/libs/provoda/provoda/BrowseMap.js";
import { describe, expect, it } from "vitest";
import { addSessionRoot } from "../runtime/sessionPool";
import { bootDktModels } from "../testingInit";

type Ctx = Awaited<ReturnType<typeof bootDktModels>>;

const openSession = async (ctx: Ctx, sessionKey: string) => {
	let session: Ctx["sessionRoot"] | undefined;
	await ctx.lockToRead(async () => {
		session = (await hookSessionRoot(ctx.appModel, {
			rel: "$session_root",
			attrs: {
				sessionKey,
				route: null,
				storageOpenStatus: ctx.getAttr(ctx.sessionRoot, "storageOpenStatus"),
			},
		})) as Ctx["sessionRoot"];
		await addSessionRoot(ctx.appModel as never, session as never);
	});
	if (!session) throw new Error("session was not created");
	return session;
};

const activeTitle = async (ctx: Ctx, session: Ctx["sessionRoot"]) => {
	const [project] = await ctx.queryRel(session, "activeProject");
	return {
		title: project ? ctx.getAttr(project, "title") : null,
		projectId: ctx.getAttr(session, "activeProjectId"),
		nodeId: project?._node_id ?? null,
	};
};

const create = (ctx: Ctx, title: string) =>
	ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", { title });
	});

describe("a new session opens the last active project", () => {
	it("keeps the auto-created first project active in the first session", async () => {
		const ctx = await bootDktModels();
		const first = await activeTitle(ctx, ctx.sessionRoot);
		expect(first.title).toBe("Project 1");
		expect(first.projectId).toBe(first.nodeId);
	});

	it("gives the second session the project the first one made active last", async () => {
		const ctx = await bootDktModels();
		await create(ctx, "A");
		await create(ctx, "B");

		const second = await openSession(ctx, "second");
		const opened = await activeTitle(ctx, second);
		expect(opened.title).toBe("B");
		// Export is enabled by the active project id attr.
		expect(opened.projectId).toBe(opened.nodeId);
		expect(opened.projectId).not.toBeNull();
	});

	it("follows a switch made in an existing window", async () => {
		const ctx = await bootDktModels();
		await create(ctx, "A");
		const projectA = (await activeTitle(ctx, ctx.sessionRoot)).nodeId;
		await create(ctx, "B");
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("setActiveProject", projectA);
		});

		const second = await openSession(ctx, "second");
		expect((await activeTitle(ctx, second)).title).toBe("A");

		// A switch in the second window is what a third one opens.
		const projectB = (await ctx.queryRel(ctx.appModel, "project")).find(
			(project) => ctx.getAttr(project, "title") === "B",
		)?._node_id;
		await ctx.lockToRead(async () => {
			await second.dispatch("setActiveProject", projectB);
		});
		const third = await openSession(ctx, "third");
		expect((await activeTitle(ctx, third)).title).toBe("B");
	});

	it("does not change the project of an already open session", async () => {
		const ctx = await bootDktModels();
		await create(ctx, "A");
		await openSession(ctx, "second");
		await create(ctx, "B");
		expect((await activeTitle(ctx, ctx.sessionRoot)).title).toBe("B");
	});
});
