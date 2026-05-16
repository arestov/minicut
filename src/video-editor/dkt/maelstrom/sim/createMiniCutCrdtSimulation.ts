import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { drainCrdtOutbox } from "../../test/crdtAssertions";
import { waitForRuntimeIdle } from "../../test/waitForRuntimeIdle";
import { bootDktModels, type DktTestContext } from "../../testingInit";
import { DeterministicMiniCutNetwork, type MiniCutNetworkMessage, type MiniCutPeerId } from "./DeterministicMiniCutNetwork";

type RuntimeModel = DktTestContext["sessionRoot"];

export type MiniCutPeer = {
	id: MiniCutPeerId;
	ctx: DktTestContext;
	project: RuntimeModel;
	videoTrack: RuntimeModel;
	audioTrack: RuntimeModel;
	dispatch: (target: RuntimeModel, actionName: string, payload?: unknown, meta?: unknown) => Promise<void>;
	flushOutbound: () => void;
	readProjectTitle: () => unknown;
	readVideoClipIds: () => string[];
	readConflictSummary: () => MiniCutConflictSummary;
};

export type MiniCutConflictSummary = {
	openModelConflicts: number;
	openTimelineConflicts: number;
	openTimingConflicts: number;
};

const PROFILE_ID = "minicut-crdt-v1";
const PROFILE_VERSION = 1;

const findModel = (ctx: DktTestContext, nodeId: string): RuntimeModel => {
	const runtimeModel = (ctx.runtime as { models?: Record<string, RuntimeModel> }).models?.[nodeId];
	if (runtimeModel) return runtimeModel;
	const sessionModel = getModelById(ctx.sessionRoot, nodeId) as RuntimeModel | null;
	if (!sessionModel) {
		throw new Error(`MiniCut maelstrom model was not found: ${nodeId}`);
	}
	return sessionModel;
};

const receiveNetworkMessage = async (ctx: DktTestContext, message: MiniCutNetworkMessage) => {
	const opsByNode = new Map<string, unknown[]>();
	for (const op of message.packet.ops ?? []) {
		const nodeId = (op as { node_id?: unknown } | null)?.node_id;
		if (typeof nodeId !== "string" || !nodeId) {
			throw new Error("MiniCut maelstrom received op without node_id");
		}
		const ops = opsByNode.get(nodeId) ?? [];
		ops.push(op);
		opsByNode.set(nodeId, ops);
	}
	for (const [nodeId, ops] of opsByNode) {
		await ctx.runtime.crdt_runtime?.receiveCanonicalOps?.(findModel(ctx, nodeId), ops);
	}
	await waitForRuntimeIdle(ctx);
};

const attrNumber = (model: RuntimeModel, attrName: string): number => Number(model.states?.[attrName] ?? 0);

const createPeer = async (id: MiniCutPeerId, network: DeterministicMiniCutNetwork): Promise<MiniCutPeer> => {
	const ctx = await bootDktModels({
		aggregateValidation: "error",
		crdt: {
			enabled: true,
			peerId: id,
			profileId: PROFILE_ID,
			profileVersion: PROFILE_VERSION,
			storage: "memory",
			transport: null,
		},
	});
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "MiniCut maelstrom project",
			fps: 30,
			width: 1920,
			height: 1080,
			duration: 12,
		});
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected active project");
	const tracks = await ctx.queryRel(project, "tracks");
	const videoTrack = tracks.find((track) => ctx.getAttr(track, "kind") === "video");
	const audioTrack = tracks.find((track) => ctx.getAttr(track, "kind") === "audio");
	if (!videoTrack || !audioTrack) throw new Error("Expected video and audio tracks");
	drainCrdtOutbox(ctx.runtime);

	network.registerPeer(id, (message) => receiveNetworkMessage(ctx, message));

	const peer: MiniCutPeer = {
		id,
		ctx,
		project,
		videoTrack,
		audioTrack,
		async dispatch(target, actionName, payload, meta) {
			await ctx.lockToRead(async () => {
				await target.dispatch(actionName, payload, null, meta);
			});
		},
		flushOutbound() {
			const ops = drainCrdtOutbox(ctx.runtime);
			if (ops.length > 0) {
				network.enqueue(id, {
					profileId: PROFILE_ID,
					profileVersion: PROFILE_VERSION,
					peerId: id,
					ops,
				});
			}
		},
		readProjectTitle() {
			return ctx.getAttr(project, "title");
		},
		readVideoClipIds() {
			const clips = videoTrack.children_models?.clips;
			return Array.isArray(clips)
				? clips
						.map((entry: unknown) => typeof entry === "string" ? entry : (entry as { _node_id?: unknown } | null)?._node_id)
						.filter((value): value is string => typeof value === "string")
				: [];
		},
		readConflictSummary() {
			return {
				openModelConflicts: attrNumber(project, "$meta$model$crdt$open_conflicts_count"),
				openTimelineConflicts: attrNumber(videoTrack, "$meta$aggregates$crdt$timelineMembership$open_conflicts_count"),
				openTimingConflicts: attrNumber(videoTrack, "$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
			};
		},
	};

	return peer;
};

export const createMiniCutCrdtSimulation = async (options: { peers: MiniCutPeerId[] }) => {
	const network = new DeterministicMiniCutNetwork();
	const peers = new Map<MiniCutPeerId, MiniCutPeer>();
	for (const id of options.peers) {
		peers.set(id, await createPeer(id, network));
	}

	return {
		network,
		peers,
		peer(id: MiniCutPeerId): MiniCutPeer {
			const peer = peers.get(id);
			if (!peer) throw new Error(`Unknown MiniCut maelstrom peer: ${id}`);
			return peer;
		},
		async waitForIdle() {
			await Promise.all([...peers.values()].map((peer) => waitForRuntimeIdle(peer.ctx)));
		},
	};
};