import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { hookSessionRoot } from "dkt-all/libs/provoda/provoda/BrowseMap.js";
import { describe, expect, it } from "vitest";
import {
	createEffectContractFakes,
	createTaskProtocolDriver,
	type EffectContractFakes,
	type RecordedCall,
} from "../test/effectContractFakes";
import { runDktStorageRequest, type DktStorageRequest } from "../storage/dktStorageRequest";
import { addSessionRoot, removeSessionRoot } from "../runtime/sessionPool";
import { bootDktModels, type DktTestContext } from "../testingInit";

type Model = DktTestContext["sessionRoot"];

const createIndexedDbStorage = () => ({
	type: "indexeddb" as const,
	dbName: `minicut-restore-boot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	indexedDB,
	keyRange: IDBKeyRange,
});

const importPayload = (name: string) => ({
	name,
	kind: "video",
	url: "",
	mime: "video/webm",
	duration: 4,
	size: 10,
	status: "ready",
	source: { kind: "local" },
	operationId: `import:${name}`,
	attemptId: `import:${name}:attempt`,
	bootId: "import-boot",
	recoveryKind: "import",
	intent: "restore",
	original: { kind: "video", duration: 4, streams: { videoStreams: 1, audioStreams: null } },
	requiredSourceEnd: 4,
	createdAt: 1,
	updatedAt: 1,
});

const dispatch = (ctx: DktTestContext, scope: Model, name: string, payload?: unknown) =>
	ctx.lockToRead(async () => {
		await scope.dispatch(name, payload);
	});

const restoreCalls = (fakes: EffectContractFakes): RecordedCall[] =>
	fakes.mediaRecoveryCalls.filter((call) => String(call.operationId).startsWith("restore:"));

const resourceNames = async (ctx: DktTestContext, calls: RecordedCall[]) => {
	const resources = await ctx.queryRel(ctx.appModel, "resource");
	const out: string[] = [];
	for (const call of calls) {
		const resource = resources.find((item) => item._node_id === call.resourceId);
		out.push(String(await ctx.queryAttr(resource, "name")));
	}
	return out.sort();
};

/** Boot 1: two projects with resources imported in this boot (the import covers the boot). */
const bootFirst = async (fakes: EffectContractFakes) => {
	const ctx = await bootDktModels({
		interfaces: fakes.interfaces as unknown as Record<string, unknown>,
		crdt: { enabled: true, peerId: "restore-boot", storage: createIndexedDbStorage(), transport: null },
	});
	const projectIds: string[] = [];
	for (const [title, files] of [
		["P1", ["r1a", "r1b"]],
		["P2", ["r2a"]],
	] as const) {
		await dispatch(ctx, ctx.sessionRoot, "createProject", { title });
		const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0]!;
		projectIds.push(project._node_id as string);
		for (const file of files) await dispatch(ctx, project, "importResource", importPayload(file));
	}
	return { ctx, projectIds };
};

const reboot = async (
	previous: DktTestContext,
	fakes: EffectContractFakes,
): Promise<DktTestContext> => {
	const dktStorage = previous.storagePackage?.dktStorage as {
		getSnapshot?: DktStorageRequest<unknown>;
	};
	const snapshot = await runDktStorageRequest(dktStorage.getSnapshot!);
	return bootDktModels({
		interfaces: fakes.interfaces as unknown as Record<string, unknown>,
		reinitFromSnapshot: snapshot,
		crdt: { enabled: true, peerId: "restore-boot", storage: previous.storagePackage ?? "memory", transport: null },
	});
};

const openSecondSession = async (ctx: DktTestContext): Promise<Model> => {
	let session!: Model;
	await ctx.lockToRead(async () => {
		session = (await hookSessionRoot(ctx.appModel, {
			rel: "$session_root",
			attrs: { sessionKey: "second-session", route: null },
		})) as Model;
		await addSessionRoot(ctx.appModel as never, session as never);
	});
	return session;
};

describe("boot media restore scheduled by the model", () => {
	it("does not restore resources imported in the same boot", async () => {
		const fakes = createEffectContractFakes({ mediaRestore: true });
		await bootFirst(fakes);
		expect(restoreCalls(fakes)).toEqual([]);
		// Each import still runs its own recovery.
		expect(fakes.mediaRecoveryCalls).toHaveLength(3);
	});

	it("starts one restore per resource of the attended project, once per boot", async () => {
		const first = createEffectContractFakes({ mediaRestore: true });
		const { ctx: boot1, projectIds } = await bootFirst(first);
		const [p1, p2] = projectIds as [string, string];

		const fakes = createEffectContractFakes({ mediaRestore: true });
		const ctx = await reboot(boot1, fakes);
		// Looking at a project starts its resources.
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", p2);
		expect(await resourceNames(ctx, restoreCalls(fakes))).toEqual(["r2a"]);
		const stamp = restoreCalls(fakes)[0]!.bootId;
		expect(restoreCalls(fakes)[0]!.intent).toBe("restore");

		// Switching to another project starts its resources only.
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", p1);
		expect(await resourceNames(ctx, restoreCalls(fakes))).toEqual(["r1a", "r1b", "r2a"]);
		expect(restoreCalls(fakes).every((call) => call.bootId === stamp)).toBe(true);

		// A second session on a project that is already attended adds nothing.
		const second = await openSecondSession(ctx);
		await dispatch(ctx, second, "setActiveProject", p1);
		expect(restoreCalls(fakes)).toHaveLength(3);

		// Switching back in the same boot does not repeat.
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", p2);
		await dispatch(ctx, second, "setActiveProject", p2);
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", p1);
		expect(restoreCalls(fakes)).toHaveLength(3);
	});

	it("a closed session no longer counts as attention", async () => {
		const { ctx: boot1, projectIds } = await bootFirst(createEffectContractFakes({ mediaRestore: true }));
		const [p1, p2] = projectIds as [string, string];
		const fakes = createEffectContractFakes({ mediaRestore: true });
		const ctx = await reboot(boot1, fakes);
		const second = await openSecondSession(ctx);
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", p2);
		await dispatch(ctx, second, "setActiveProject", p1);
		expect(await resourceNames(ctx, restoreCalls(fakes))).toEqual(["r1a", "r1b", "r2a"]);
		const attended = async () =>
			(await ctx.queryRel(ctx.appModel, "attendedProject")).map((item) => item._node_id).sort();
		expect(await attended()).toEqual([p1, p2].sort());

		await ctx.lockToRead(async () => {
			await removeSessionRoot(ctx.appModel as never, second as never);
		});
		expect(await attended()).toEqual([p2]);
		const project = (await ctx.queryRel(ctx.appModel, "project")).find((item) => item._node_id === p1)!;
		expect(await ctx.queryAttr(project, "attended")).toBe(false);
	});

	it("runs again after a new boot", async () => {
		const { ctx: boot1, projectIds } = await bootFirst(createEffectContractFakes({ mediaRestore: true }));
		const p1 = projectIds[0]!;
		const p2 = projectIds[1]!;
		const secondFakes = createEffectContractFakes({ mediaRestore: true });
		const boot2 = await reboot(boot1, secondFakes);
		await dispatch(boot2, boot2.sessionRoot, "setActiveProject", p2);
		await dispatch(boot2, boot2.sessionRoot, "setActiveProject", p1);
		expect(restoreCalls(secondFakes)).toHaveLength(3);

		const thirdFakes = createEffectContractFakes({ mediaRestore: true });
		const boot3 = await reboot(boot2, thirdFakes);
		await dispatch(boot3, boot3.sessionRoot, "setActiveProject", p2);
		await dispatch(boot3, boot3.sessionRoot, "setActiveProject", p1);
		expect(restoreCalls(thirdFakes)).toHaveLength(3);
		expect(restoreCalls(thirdFakes)[0]!.bootId).not.toBe(restoreCalls(secondFakes)[0]!.bootId);
	});

	it("schedules nothing without the platform interface", async () => {
		const { ctx: boot1, projectIds } = await bootFirst(createEffectContractFakes({ mediaRestore: true }));
		const fakes = createEffectContractFakes();
		const ctx = await reboot(boot1, fakes);
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", projectIds[0]!);
		expect(fakes.mediaRecoveryCalls).toEqual([]);
	});

	it("does not restore a resource imported into an attended project in this boot", async () => {
		const { ctx: boot1, projectIds } = await bootFirst(createEffectContractFakes({ mediaRestore: true }));
		const fakes = createEffectContractFakes({ mediaRestore: true });
		const ctx = await reboot(boot1, fakes);
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", projectIds[1]!);
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", projectIds[0]!);
		expect(restoreCalls(fakes)).toHaveLength(3);

		const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0]!;
		await dispatch(ctx, project, "importResource", importPayload("late"));
		expect(restoreCalls(fakes)).toHaveLength(3);
		expect(fakes.mediaRecoveryCalls.filter((call) => call.operationId === "import:late")).toHaveLength(1);
	});

	it("ignores a foreign result for a restore task", async () => {
		const { ctx: boot1, projectIds } = await bootFirst(createEffectContractFakes({ mediaRestore: true }));
		const fakes = createEffectContractFakes({ mediaRestore: true });
		const ctx = await reboot(boot1, fakes);
		await dispatch(ctx, ctx.sessionRoot, "setActiveProject", projectIds[1]!);
		const call = restoreCalls(fakes)[0]!;
		const resource = (await ctx.queryRel(ctx.appModel, "resource")).find((item) => item._node_id === call.resourceId)!;
		const task = (await ctx.queryRel(resource, "activeMediaRecoveryTask"))[0]!;
		expect(await ctx.queryAttr(task, "phase")).toBe("inspecting");

		const driver = createTaskProtocolDriver(ctx);
		await driver.mediaRecovery.transition(task, { operationId: "restore:foreign", phase: "failed", updatedAt: 2 });
		expect(await ctx.queryAttr(task, "phase")).toBe("inspecting");
		await driver.mediaRecovery.transition(task, { operationId: call.operationId as string, phase: "failed", reasonCode: "source-missing", updatedAt: 2 });
		expect(await ctx.queryAttr(task, "phase")).toBe("failed");
		expect(await ctx.queryAttr(task, "reasonCode")).toBe("source-missing");
	});
});
