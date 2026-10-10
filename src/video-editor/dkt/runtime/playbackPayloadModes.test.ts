import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { describe, expect, it } from "vitest";
import { createBrowserEffectInterfaces } from "../../adapters/web/createBrowserEffectInterfaces";
import { dispatchAndSettle } from "../models/action-contract-test-harness";
import { DKT_MSG, type MiniCutDktTransportMessage } from "../shared/messageTypes";
import { bootDktModels, queryAttr, queryRel, type DktTestContext } from "../testingInit";

const createObserver = () => {
	const messages: MiniCutDktTransportMessage[] = [];
	const interfaces = createBrowserEffectInterfaces({
		pages: new Set([{
			send(message: MiniCutDktTransportMessage) {
				structuredClone(message);
				messages.push(message);
			},
		}]),
		log: () => {},
	});
	return {
		interfaces,
		requests: () => messages.filter((message) => message.type === DKT_MSG.PLAYBACK_RUN_REQUEST),
	};
};

type Observer = ReturnType<typeof createObserver>;

const verifyPlayback = async (ctx: DktTestContext, observer: Observer) => {
	const root = ctx.sessionRoot;
	const [project] = await queryRel(root, "activeProject");
	expect(project).toBeDefined();
	expect(await queryAttr(root, "isPlaying")).toBe(false);
	const boundary = await queryAttr(root, "playbackBoundaryCursor");
	expect(boundary).toBe(12);
	// Exercise the registered action without fabricating a graph write.
	const boundaryEvent = { prev_value: 0, next_value: boundary };
	const repeatBoundary = async () => {
		await dispatchAndSettle(ctx, root, "handleAttr:playbackBoundaryCursor", boundaryEvent);
	};
	const stoppedCount = observer.requests().length;
	await repeatBoundary();
	expect(observer.requests()).toHaveLength(stoppedCount);
	await repeatBoundary();
	expect(observer.requests()).toHaveLength(stoppedCount);

	await dispatchAndSettle(ctx, root, "play");
	expect(await queryAttr(root, "isPlaying")).toBe(true);
	const activePayload = {
		sessionRootNodeId: root._node_id,
		run: {
			runId: 1,
			startCursorSeconds: 0,
			startedAtEpochMs: expect.any(Number),
			playbackRate: 1,
			boundaryCursorSeconds: 12,
		},
	};
	expect(observer.requests()).toHaveLength(stoppedCount + 1);
	expect(observer.requests().at(-1)?.payload).toEqual(activePayload);
	await repeatBoundary();
	expect(observer.requests()).toHaveLength(stoppedCount + 2);
	expect(observer.requests().at(-1)?.payload).toEqual(activePayload);
	await repeatBoundary();
	expect(observer.requests()).toHaveLength(stoppedCount + 3);
	expect(observer.requests().at(-1)?.payload).toEqual(activePayload);

	await dispatchAndSettle(ctx, root, "pausePlayback", { cursor: 0 });
	expect(await queryAttr(root, "isPlaying")).toBe(false);
	expect(observer.requests()).toHaveLength(stoppedCount + 4);
	expect(observer.requests().at(-1)?.payload).toEqual({
		sessionRootNodeId: root._node_id,
		run: null,
		committedCursor: 0,
	});
	const pausedCount = observer.requests().length;
	await repeatBoundary();
	expect(observer.requests()).toHaveLength(pausedCount);
	await repeatBoundary();
	expect(observer.requests()).toHaveLength(pausedCount);
};

describe("playback DTOs across model snapshot and memory restore modes", () => {
	for (const crdtEnabled of [false, true]) {
		for (const reinitialized of [false, true]) {
			it(`${reinitialized ? "reinitialized" : "fresh"}, CRDT ${crdtEnabled ? "on" : "off"}`, async () => {
				const observer = createObserver();
				let storage = makeDktCrdtMemoryStorage();
				const options = () => ({
					interfaces: observer.interfaces as unknown as Record<string, unknown>,
					crdt: crdtEnabled ? {
						enabled: true as const,
						peerId: "playback-payload-peer",
						profileId: "minicut-crdt-v1",
						profileVersion: 1,
						storage,
						transport: null,
					} : false as const,
				});
				let ctx = await bootDktModels(options());
				try {
					await dispatchAndSettle(ctx, ctx.sessionRoot, "createProject", {
						title: "Playback payload matrix",
						fps: 30, width: 1920, height: 1080, duration: 12,
					});
					if (reinitialized) {
						const [originalProject] = await queryRel(ctx.sessionRoot, "activeProject");
						expect(originalProject).toBeDefined();
						await ctx.computed();
						await ctx.storagePackage?.whenReady?.();
						const snapshot = await toReinitableData(ctx.runtime);
						await ctx.storagePackage?.whenReady?.();
						const seed = storage.cloneData();
						await ctx.close();
						storage = makeDktCrdtMemoryStorage({ seed });
						ctx = await bootDktModels({ ...options(), reinitFromSnapshot: snapshot });
						const projects = await queryRel(ctx.appModel, "project");
						const restored = projects.find((project) => project._node_id === originalProject._node_id);
						expect(restored).toBeDefined();
						await dispatchAndSettle(ctx, ctx.sessionRoot, "syncActiveProjectRel", { project: restored });
					}
					expect(Boolean(ctx.runtime.crdt_runtime)).toBe(crdtEnabled);
					await verifyPlayback(ctx, observer);
				} finally {
					await ctx.close();
				}
			});
		}
	}
});