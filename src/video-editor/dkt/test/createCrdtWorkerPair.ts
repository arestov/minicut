import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { createInMemoryCrdtRelay } from "../crdt/createInMemoryCrdtRelay";
import { createTestWorkerCrdtTransport } from "../crdt/createTestWorkerCrdtTransport";
import type { MiniCutCrdtRelayMessage } from "../crdt/testRelayContracts";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { drainCrdtOutbox } from "./crdtAssertions";
import { waitForRuntimeIdle } from "./waitForRuntimeIdle";

type RuntimeModel = DktTestContext["sessionRoot"];

type PeerRuntime = {
	ctx: DktTestContext;
	project: RuntimeModel;
	videoTrack: RuntimeModel;
	dispatch: (
		target: RuntimeModel,
		actionName: string,
		payload?: unknown,
	) => Promise<void>;
	flushOutbound: () => void;
	readProjectTitle: () => unknown;
	readVideoClipIds: () => string[];
};

type Options = {
	roomId: string;
	profileId: string;
	profileVersion: number;
};

const findModel = (ctx: DktTestContext, nodeId: string): RuntimeModel => {
	const fromRuntime = (ctx.runtime as { models?: Record<string, RuntimeModel> })
		.models?.[nodeId];
	if (fromRuntime) {
		return fromRuntime;
	}
	const fromSession = getModelById(ctx.sessionRoot, nodeId) as RuntimeModel | null;
	if (!fromSession) {
		throw new Error(`CRDT worker pair model was not found: ${nodeId}`);
	}
	return fromSession;
};

const receiveOps = async (
	ctx: DktTestContext,
	message: MiniCutCrdtRelayMessage,
) => {
	if (message.type !== "crdt-ops" && message.type !== "crdt-sync-response") {
		return;
	}
	const ops = message.packet.ops ?? [];
	const opsByNode = new Map<string, unknown[]>();
	for (const op of ops) {
		const nodeId = (op as { node_id?: unknown } | null)?.node_id;
		if (typeof nodeId !== "string" || !nodeId) {
			throw new Error("CRDT worker pair received op without node_id");
		}
		const list = opsByNode.get(nodeId) ?? [];
		list.push(op);
		opsByNode.set(nodeId, list);
	}
	for (const [nodeId, nodeOps] of opsByNode) {
		const target = findModel(ctx, nodeId);
		await ctx.runtime.crdt_runtime?.receiveCanonicalOps?.(target, nodeOps);
	}
	await waitForRuntimeIdle(ctx);
};

const createPeer = async (peerId: string): Promise<PeerRuntime> => {
	const ctx = await bootDktModels({
		crdt: {
			enabled: true,
			peerId,
			storage: "memory",
			transport: null,
		},
	});
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "CRDT worker pair project",
		});
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) {
		throw new Error("Expected active project");
	}
	const tracks = await ctx.queryRel(project, "tracks");
	const videoTrack = tracks.find((track) => ctx.getAttr(track, "kind") === "video");
	if (!videoTrack) {
		throw new Error("Expected video track");
	}
	drainCrdtOutbox(ctx.runtime);

	return {
		ctx,
		project,
		videoTrack,
		async dispatch(target, actionName, payload) {
			await ctx.lockToRead(async () => {
				await target.dispatch(actionName, payload);
			});
		},
		flushOutbound() {},
		readProjectTitle() {
			return ctx.getAttr(project, "title");
		},
		readVideoClipIds() {
			const current = videoTrack.children_models?.clips;
			if (!Array.isArray(current)) {
				return [];
			}
			return current
				.map((entry: unknown) =>
					typeof entry === "string"
						? entry
						: (entry as { _node_id?: unknown } | null)?._node_id,
				)
				.filter((id): id is string => typeof id === "string");
		},
	};
};

export const createCrdtWorkerPair = async (options: Options) => {
	const relay = createInMemoryCrdtRelay();
	const a = await createPeer("A");
	const b = await createPeer("B");

	const transportA = createTestWorkerCrdtTransport({
		relay,
		roomId: options.roomId,
		peerId: "A",
		profileId: options.profileId,
		profileVersion: options.profileVersion,
		onMessage: (message) => {
			void receiveOps(a.ctx, message);
		},
	});
	const transportB = createTestWorkerCrdtTransport({
		relay,
		roomId: options.roomId,
		peerId: "B",
		profileId: options.profileId,
		profileVersion: options.profileVersion,
		onMessage: (message) => {
			void receiveOps(b.ctx, message);
		},
	});

	a.flushOutbound = () => {
		const ops = drainCrdtOutbox(a.ctx.runtime);
		if (ops.length) {
			transportA.sendOps({ ops });
		}
	};
	b.flushOutbound = () => {
		const ops = drainCrdtOutbox(b.ctx.runtime);
		if (ops.length) {
			transportB.sendOps({ ops });
		}
	};

	return {
		a,
		b,
		relay,
		transportA,
		transportB,
		async waitForConvergence() {
			await waitForRuntimeIdle(a.ctx);
			await waitForRuntimeIdle(b.ctx);
		},
		close() {
			transportA.close();
			transportB.close();
		},
	};
};
