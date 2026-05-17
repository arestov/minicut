import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { drainCrdtOutbox } from "../../test/crdtAssertions";
import { waitForRuntimeIdle } from "../../test/waitForRuntimeIdle";
import {
	bootDktModels,
	type DktTestContext,
	type MiniCutDktCrdtStorageOptions,
} from "../../testingInit";
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
	readProjectTitle: () => Promise<unknown>;
	readVideoClipIds: () => Promise<string[]>;
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

type NodeAliasMap = Map<string, string>;

const remapOpNode = (op: unknown, aliases: NodeAliasMap): unknown => {
	if (!op || typeof op !== "object") return op;
	const next = { ...(op as Record<string, unknown>) };
	const nodeId = typeof next.node_id === "string" ? next.node_id : null;
	if (nodeId && aliases.has(nodeId)) {
		next.node_id = aliases.get(nodeId);
	}
	return next;
};

const receiveNetworkMessage = async (
	ctx: DktTestContext,
	message: MiniCutNetworkMessage,
	aliases: NodeAliasMap,
) => {
	const opsByNode = new Map<string, unknown[]>();
	for (const rawOp of message.packet.ops ?? []) {
		const op = remapOpNode(rawOp, aliases);
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

type SimulationOptions = {
	peers: MiniCutPeerId[];
	storage?: MiniCutDktCrdtStorageOptions | ((peerId: MiniCutPeerId) => MiniCutDktCrdtStorageOptions);
	unloadModels?: boolean;
};

const resolveStorage = (
	options: SimulationOptions,
	id: MiniCutPeerId,
): MiniCutDktCrdtStorageOptions =>
	typeof options.storage === "function"
		? options.storage(id)
		: (options.storage ?? "memory");

const wrapPeer = async (
	id: MiniCutPeerId,
	ctx: DktTestContext,
	network: DeterministicMiniCutNetwork,
	aliasMaps: Map<MiniCutPeerId, NodeAliasMap>,
): Promise<MiniCutPeer> => {
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected active project");
	const tracks = await ctx.queryRel(project, "tracks");
	const trackKinds = await Promise.all(
		tracks.map(async (track) => ({
			track,
			kind: await ctx.queryAttr(track, "kind"),
		})),
	);
	const videoTrack = trackKinds.find((item) => item.kind === "video")?.track;
	const audioTrack = trackKinds.find((item) => item.kind === "audio")?.track;
	if (!videoTrack || !audioTrack) throw new Error("Expected video and audio tracks");

	network.registerPeer(id, (message) => receiveNetworkMessage(ctx, message, aliasMaps.get(id) ?? new Map()));

	return {
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
		async readProjectTitle() {
			return ctx.queryAttr(project, "title");
		},
		async readVideoClipIds() {
			const clips = await ctx.queryRel(videoTrack, "clips");
			return clips.map((clip) => String(clip._node_id));
		},
		readConflictSummary() {
			return {
				openModelConflicts: attrNumber(project, "$meta$model$crdt$open_conflicts_count"),
				openTimelineConflicts: attrNumber(videoTrack, "$meta$aggregates$crdt$timelineMembership$open_conflicts_count"),
				openTimingConflicts: attrNumber(videoTrack, "$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
			};
		},
	};
};

const createPeer = async (
	id: MiniCutPeerId,
	network: DeterministicMiniCutNetwork,
	options: SimulationOptions,
	aliasMaps: Map<MiniCutPeerId, NodeAliasMap>,
): Promise<MiniCutPeer> => {
	const ctx = await bootDktModels({
		aggregateValidation: "error",
		unloadModels: options.unloadModels,
		crdt: {
			enabled: true,
			peerId: id,
			profileId: PROFILE_ID,
			profileVersion: PROFILE_VERSION,
			storage: resolveStorage(options, id),
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
	drainCrdtOutbox(ctx.runtime);
	return wrapPeer(id, ctx, network, aliasMaps);
};

const addBaseGraphAliases = (
	peers: Map<MiniCutPeerId, MiniCutPeer>,
	aliasMaps: Map<MiniCutPeerId, NodeAliasMap>,
) => {
	for (const toPeer of peers.values()) {
		const aliases = aliasMaps.get(toPeer.id);
		if (!aliases) continue;
		for (const fromPeer of peers.values()) {
			if (fromPeer.id === toPeer.id) continue;
			aliases.set(String(fromPeer.project._node_id), String(toPeer.project._node_id));
			aliases.set(String(fromPeer.videoTrack._node_id), String(toPeer.videoTrack._node_id));
			aliases.set(String(fromPeer.audioTrack._node_id), String(toPeer.audioTrack._node_id));
		}
	}
};

export const createMiniCutCrdtSimulation = async (options: SimulationOptions) => {
	const network = new DeterministicMiniCutNetwork();
	const peers = new Map<MiniCutPeerId, MiniCutPeer>();
	const aliasMaps = new Map<MiniCutPeerId, NodeAliasMap>();
	for (const id of options.peers) {
		aliasMaps.set(id, new Map());
	}
	for (const id of options.peers) {
		peers.set(id, await createPeer(id, network, options, aliasMaps));
	}
	addBaseGraphAliases(peers, aliasMaps);

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
		async reinitPeer(id: MiniCutPeerId) {
			const current = peers.get(id);
			if (!current) throw new Error(`Unknown MiniCut maelstrom peer: ${id}`);
			const snapshot = await (
				current.ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
			)?.getSnapshot?.();
			if (!snapshot) throw new Error(`MiniCut maelstrom peer ${id} has no snapshot`);
			const ctx = await bootDktModels({
				aggregateValidation: "error",
				unloadModels: options.unloadModels,
				reinitFromSnapshot: snapshot,
				crdt: {
					enabled: true,
					peerId: id,
					profileId: PROFILE_ID,
					profileVersion: PROFILE_VERSION,
					storage: current.ctx.storagePackage ?? resolveStorage(options, id),
					transport: null,
				},
			});
			const restarted = await wrapPeer(id, ctx, network, aliasMaps);
			peers.set(id, restarted);
			addBaseGraphAliases(peers, aliasMaps);
			return restarted;
		},
	};
};
