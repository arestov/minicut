import { queryAddr } from "dkt/async/queryAddr.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import type {
	DktCrdtTransport,
	DktCrdtWireMessage,
} from "../../crdt/testRelayContracts";
import { createMiniCutHarnessWorkspaceId } from "../../storage/minicutWorkspaceManifest";
import {
	runDktStorageRequest,
	type DktStorageRequest,
} from "../../storage/dktStorageRequest";
import { waitForRuntimeIdle } from "../../test/waitForRuntimeIdle";
import {
	bootDktModels,
	type DktTestContext,
	type MiniCutDktCrdtStorageOptions,
} from "../../testingInit";
import {
	DeterministicMiniCutNetwork,
	type MiniCutNetworkMessage,
	type MiniCutPeerId,
} from "./DeterministicMiniCutNetwork";

type RuntimeModel = DktTestContext["sessionRoot"];

const queryAddrLoose = queryAddr as unknown as (
	model: RuntimeModel,
	addr: string,
) => Promise<unknown>;

export type MiniCutPeer = {
	id: MiniCutPeerId;
	ctx: DktTestContext;
	project: RuntimeModel;
	videoTrack: RuntimeModel;
	audioTrack: RuntimeModel;
	dispatch: (
		target: RuntimeModel,
		actionName: string,
		payload?: unknown,
		meta?: unknown,
	) => Promise<void>;
	flushOutbound: () => void;
	readProjectTitle: () => Promise<unknown>;
	readVideoClipIds: () => Promise<string[]>;
	readConflictSummary: () => MiniCutConflictSummary;
	queryVideoClips: () => Promise<RuntimeModel[]>;
};

export type MiniCutConflictSummary = {
	openModelConflicts: number;
	openTimelineConflicts: number;
	openTimingConflicts: number;
};

const PROFILE_ID = "minicut-crdt-v1";
const PROFILE_VERSION = 1;

const cloneWireMessage = (message: DktCrdtWireMessage): DktCrdtWireMessage =>
	JSON.parse(JSON.stringify(message)) as DktCrdtWireMessage;

/**
 * Every wire message a peer has sent, in order. A peer that joins later gets
 * this CRDT history replayed, like a real second device syncing from a relay.
 */
type OutgoingHistory = Map<MiniCutPeerId, DktCrdtWireMessage[]>;

type NetworkTransport = DktCrdtTransport & {
	replay(messages: DktCrdtWireMessage[]): Promise<void>;
};

const createNetworkTransport = (
	id: MiniCutPeerId,
	network: DeterministicMiniCutNetwork,
	getContext: () => DktTestContext | null,
	outgoingHistory: OutgoingHistory,
): NetworkTransport => {
	const listeners = new Set<(message: DktCrdtWireMessage) => void>();
	network.registerPeer(id, async (message: MiniCutNetworkMessage) => {
		for (const listener of [...listeners]) {
			await Promise.resolve(listener(cloneWireMessage(message.packet.payload)));
		}
		const ctx = getContext();
		if (ctx) {
			await waitForPeerIdle(ctx);
		}
	});
	return {
		async replay(messages) {
			for (const message of messages) {
				for (const listener of [...listeners]) {
					await Promise.resolve(listener(cloneWireMessage(message)));
				}
			}
		},
		send(message) {
			const history = outgoingHistory.get(id) ?? [];
			history.push(cloneWireMessage(message));
			outgoingHistory.set(id, history);
			network.enqueue(id, {
				profileId: PROFILE_ID,
				profileVersion: PROFILE_VERSION,
				peerId: id,
				payload: cloneWireMessage(message),
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close() {
			listeners.clear();
		},
	};
};

const attrNumber = (model: RuntimeModel, attrName: string): number =>
	Number(model.states?.[attrName] ?? 0);

const queryVideoTrackClips = async (
	ctx: DktTestContext,
	videoTrack: RuntimeModel,
): Promise<RuntimeModel[]> => {
	const clipsFromRel = await ctx.queryRel(videoTrack, "clips");
	if (clipsFromRel.length > 0) return clipsFromRel;
	const snapshotRequest = (
		ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot as DktStorageRequest<unknown> | undefined;
	const snapshot = snapshotRequest
		? await runDktStorageRequest(snapshotRequest)
		: null;
	const snapshotClipRefs = (
		snapshot as {
			models?: Record<string, { rels?: Record<string, unknown> }>;
		} | null
	)?.models?.[String(videoTrack._node_id)]?.rels?.clips;
	if (Array.isArray(snapshotClipRefs) && snapshotClipRefs.length > 0) {
		return snapshotClipRefs
			.map((item) => {
				const id =
					typeof item === "string"
						? item
						: String((item as { _node_id?: unknown } | null)?._node_id ?? "");
				const model = id
					? ((ctx.runtime as { models?: Record<string, RuntimeModel> })
							.models?.[id] ??
						(getModelById(ctx.appModel, id) as RuntimeModel | null))
					: null;
				return model;
			})
			.filter((item): item is RuntimeModel => Boolean(item));
	}
	const allClipsFromRel = await ctx.queryRel(ctx.appModel, "clip");
	const allClips =
		allClipsFromRel.length > 0
			? allClipsFromRel
			: ((await queryAddrLoose(
					ctx.appModel,
					"<< @all:clip",
				)) as RuntimeModel[]);
	const pairs = await Promise.all(
		allClips.map(async (clip) => ({
			clip,
			track: (await ctx.queryRel(clip, "track"))[0],
		})),
	);
	return pairs
		.filter((item) => item.track?._node_id === videoTrack._node_id)
		.map((item) => item.clip);
};

const findProjectInSnapshot = (
	ctx: DktTestContext,
	snapshot: unknown,
	preferredProjectId?: string,
): RuntimeModel | null => {
	const models =
		(
			snapshot as {
				models?: Record<
					string,
					{ attrs?: Record<string, unknown>; model_name?: string }
				>;
			} | null
		)?.models ?? {};
	const projectEntries = Object.entries(models).filter(
		([, model]) => model.model_name === "project",
	);
	const selectedEntry =
		(preferredProjectId
			? projectEntries.find(([id]) => id === preferredProjectId)
			: null) ??
		projectEntries.find(
			([, model]) => model.attrs?.title === "MiniCut maelstrom project",
		) ??
		projectEntries[0];
	if (!selectedEntry) return null;
	return getModelById(ctx.appModel, selectedEntry[0]) as RuntimeModel | null;
};

const commitDktStorage = async (
	ctx: DktTestContext,
	meta: { reason: string },
) => {
	const packageCommit = ctx.storagePackage?.commitChanges;
	const dktStorageCommit = (
		ctx.storagePackage?.dktStorage as
			| { commitChanges?: DktStorageRequest<unknown, [unknown?]> }
			| undefined
	)?.commitChanges;
	if (packageCommit) {
		await packageCommit.call(ctx.storagePackage, meta);
		return;
	}
	if (dktStorageCommit) await runDktStorageRequest(dktStorageCommit, meta);
};

const waitForDktStorageReady = async (ctx: DktTestContext) => {
	const packageReady = ctx.storagePackage?.whenReady;
	const dktStorageReady = (
		ctx.storagePackage?.dktStorage as
			| { whenReady?: () => Promise<unknown> | unknown }
			| undefined
	)?.whenReady;
	if (packageReady) {
		await packageReady.call(ctx.storagePackage);
		return;
	}
	await dktStorageReady?.();
};

const waitForPeerIdle = async (ctx: DktTestContext) => {
	await waitForRuntimeIdle(ctx);
	await waitForDktStorageReady(ctx);
};

type SimulationOptions = {
	peers: MiniCutPeerId[];
	roomId?: string;
	workspaceIdForPeer?: (peerId: MiniCutPeerId) => string;
	storage?:
		| MiniCutDktCrdtStorageOptions
		| ((peerId: MiniCutPeerId) => MiniCutDktCrdtStorageOptions);
	unloadModels?: boolean;
};

const resolveStorage = (
	options: SimulationOptions,
	id: MiniCutPeerId,
): MiniCutDktCrdtStorageOptions =>
	typeof options.storage === "function"
		? options.storage(id)
		: (options.storage ?? "memory");

const resolveWorkspaceId = (
	options: SimulationOptions,
	id: MiniCutPeerId,
): string | undefined =>
	options.workspaceIdForPeer?.(id) ??
	(options.roomId
		? createMiniCutHarnessWorkspaceId(`${options.roomId}:${id}`)
		: undefined);

const seedGraphStorageFromSnapshot = async (
	ctx: DktTestContext,
	snapshot: unknown,
	reason: string,
) => {
	const dktStorage = ctx.storagePackage?.dktStorage as
		| {
				createModel?: (
					id: string,
					modelName: string,
					attrs?: Record<string, unknown>,
					rels?: Record<string, unknown>,
					mentions?: Record<string, unknown>,
				) => Promise<unknown> | unknown;
				createExpectedRel?: (
					key: string,
					data: unknown,
				) => Promise<unknown> | unknown;
				putProjectMeta?: (meta: unknown) => Promise<unknown> | unknown;
				commitChanges?: DktStorageRequest<unknown, [unknown?]>;
		  }
		| undefined;
	if (!dktStorage?.createModel) return;
	const raw = snapshot as {
		models?: Record<
			string,
			{
				attrs?: Record<string, unknown>;
				model_name?: string;
				rels?: Record<string, unknown>;
				mentions?: Record<string, unknown> | null;
			}
		>;
		expected_rels_to_chains?: Record<string, unknown>;
		meta?: unknown;
	} | null;
	if (!raw?.models) return;
	for (const [id, model] of Object.entries(raw.models)) {
		if (!model?.model_name) continue;
		await dktStorage.createModel(
			id,
			model.model_name,
			model.attrs ?? {},
			model.rels ?? {},
			model.mentions ?? {},
		);
	}
	for (const [key, data] of Object.entries(raw.expected_rels_to_chains ?? {})) {
		await dktStorage.createExpectedRel?.(key, data);
	}
	if (raw.meta !== undefined) {
		await dktStorage.putProjectMeta?.(raw.meta);
	}
	if (dktStorage.commitChanges) {
		await runDktStorageRequest(dktStorage.commitChanges, { reason });
	}
};

const enableUnloadNow = async (ctx: DktTestContext, enabled: boolean) => {
	if (!enabled) return;
	const runtime = ctx.runtime as {
		enableUnload?: () => void;
	};
	runtime.enableUnload?.();
	await waitForPeerIdle(ctx);
};

const readDurableOrLiveSnapshot = async (
	ctx: DktTestContext,
	options: SimulationOptions,
): Promise<unknown> => {
	const snapshotRequest = (
		ctx.storagePackage?.dktStorage as { getSnapshot?: DktStorageRequest<unknown> }
	)?.getSnapshot;
	const durableSnapshot = snapshotRequest
		? await runDktStorageRequest(snapshotRequest)
		: null;
	if (durableSnapshot) return durableSnapshot;
	if (options.unloadModels !== true) {
		let snapshot: unknown = null;
		await ctx.lockToRead(async () => {
			snapshot = await toReinitableData(ctx.runtime);
		});
		return snapshot;
	}
	return durableSnapshot ?? (await toReinitableData(ctx.runtime));
};

const wrapPeer = async (
	id: MiniCutPeerId,
	ctx: DktTestContext,
): Promise<MiniCutPeer> => {
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected active project");
	const tracksFromRel = await ctx.queryRel(project, "tracks");
	const tracksFromAddr = (await queryAddrLoose(
		project,
		"<< @all:tracks",
	)) as RuntimeModel[];
	const tracks = tracksFromRel.length > 0 ? tracksFromRel : tracksFromAddr;
	const trackKinds = await Promise.all(
		tracks.map(async (track) => ({
			track,
			kind: await ctx.queryAttr(track, "kind"),
		})),
	);
	const videoTrack = trackKinds.find((item) => item.kind === "video")?.track;
	const audioTrack = trackKinds.find((item) => item.kind === "audio")?.track;
	if (!videoTrack || !audioTrack) {
		throw new Error(
			`Expected video and audio tracks: ${JSON.stringify({
				project: project._node_id,
				tracksFromRel: tracksFromRel.length,
				tracksFromAddr: tracksFromAddr.length,
				projectRels: (project as { rels?: Record<string, unknown> }).rels,
				tracks: trackKinds.map((item) => ({
					id: item.track?._node_id,
					modelName: item.track?.model_name,
					kind: item.kind,
				})),
			})}`,
		);
	}

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
			(
				ctx.runtime.crdt_runtime as {
					flushTransportOutbox?: () => unknown;
				} | null
			)?.flushTransportOutbox?.();
		},
		async readProjectTitle() {
			return ctx.queryAttr(project, "title");
		},
		async readVideoClipIds() {
			const clips = await queryVideoTrackClips(ctx, videoTrack);
			return clips.map((clip) => String(clip._node_id));
		},
		async queryVideoClips() {
			return queryVideoTrackClips(ctx, videoTrack);
		},
		readConflictSummary() {
			return {
				openModelConflicts: attrNumber(
					project,
					"$meta$model$crdt$open_conflicts_count",
				),
				openTimelineConflicts: attrNumber(
					videoTrack,
					"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
				),
				openTimingConflicts: attrNumber(
					videoTrack,
					"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
				),
			};
		},
	};
};

const createPeer = async (
	id: MiniCutPeerId,
	network: DeterministicMiniCutNetwork,
	options: SimulationOptions,
	outgoingHistory: OutgoingHistory,
	join: {
		/** Restart over an existing store: graph snapshot of the SAME peer's CRDT storage. */
		snapshot?: unknown;
		storagePackage?: MiniCutDktCrdtStorageOptions;
		preferredProjectId?: string;
		/** New device: receive these peers' CRDT history instead of a graph snapshot. */
		historyFrom?: MiniCutPeerId[];
	} = {},
): Promise<DktTestContext> => {
	const { snapshot, storagePackage, preferredProjectId, historyFrom } = join;
	let activeContext: DktTestContext | null = null;
	const transport = createNetworkTransport(
		id,
		network,
		() => activeContext,
		outgoingHistory,
	);
	const ctx = await bootDktModels({
		aggregateValidation: "error",
		unloadModels: false,
		reinitFromSnapshot: snapshot,
		crdt: {
			enabled: true,
			peerId: id,
			profileId: PROFILE_ID,
			profileVersion: PROFILE_VERSION,
			storage: storagePackage ?? resolveStorage(options, id),
			workspaceId: resolveWorkspaceId(options, id),
			transport,
		},
	});
	activeContext = ctx;
	if (snapshot) {
		await seedGraphStorageFromSnapshot(
			ctx,
			snapshot,
			"minicut-maelstrom-seed-snapshot",
		);
		await ctx.lockToRead(async () => {
			const project = findProjectInSnapshot(ctx, snapshot, preferredProjectId);
			if (!project)
				throw new Error(
					"Expected shared project in MiniCut maelstrom snapshot",
				);
			await ctx.sessionRoot.dispatch("syncActiveProjectRel", { project });
		});
	}
	if (historyFrom?.length) {
		for (const sourceId of historyFrom) {
			await transport.replay(outgoingHistory.get(sourceId) ?? []);
			await waitForPeerIdle(ctx);
		}
		await ctx.lockToRead(async () => {
			const project = preferredProjectId
				? (getModelById(ctx.appModel, preferredProjectId) as RuntimeModel | null)
				: null;
			if (!project)
				throw new Error(
					"Expected shared project in replayed MiniCut maelstrom CRDT history",
				);
			await ctx.sessionRoot.dispatch("syncActiveProjectRel", { project });
		});
	}
	await waitForPeerIdle(ctx);
	await commitDktStorage(ctx, {
		reason: snapshot
			? "minicut-maelstrom-bootstrap-snapshot"
			: "minicut-maelstrom-bootstrap",
	});
	return ctx;
};

const createProjectOnPrimary = async (
	primaryId: MiniCutPeerId,
	contexts: Map<MiniCutPeerId, DktTestContext>,
) => {
	const primary = contexts.get(primaryId);
	if (!primary)
		throw new Error(`Missing primary MiniCut maelstrom peer: ${primaryId}`);
	await primary.lockToRead(async () => {
		await primary.sessionRoot.dispatch("createProject", {
			title: "MiniCut maelstrom project",
			fps: 30,
			width: 1920,
			height: 1080,
			duration: 12,
		});
	});
	await waitForPeerIdle(primary);
	(
		primary.runtime.crdt_runtime as {
			flushTransportOutbox?: () => unknown;
		} | null
	)?.flushTransportOutbox?.();
	const project = (
		await primary.queryRel(primary.sessionRoot, "activeProject")
	)[0];
	if (!project) throw new Error("Expected primary project after bootstrap");
};

export const createMiniCutCrdtSimulation = async (
	options: SimulationOptions,
) => {
	const network = new DeterministicMiniCutNetwork();
	const peers = new Map<MiniCutPeerId, MiniCutPeer>();
	const contexts = new Map<MiniCutPeerId, DktTestContext>();
	const outgoingHistory: OutgoingHistory = new Map();
	const primaryId = options.peers[0];
	if (!primaryId)
		throw new Error("MiniCut maelstrom requires at least one peer");
	const primaryCtx = await createPeer(primaryId, network, options, outgoingHistory);
	contexts.set(primaryId, primaryCtx);
	await createProjectOnPrimary(primaryId, contexts);
	const primaryProjectId = String(
		(await primaryCtx.queryRel(primaryCtx.sessionRoot, "activeProject"))[0]
			?._node_id ?? "",
	);
	for (const id of options.peers.slice(1)) {
		contexts.set(
			id,
			await createPeer(id, network, options, outgoingHistory, {
				historyFrom: [primaryId],
				preferredProjectId: primaryProjectId,
			}),
		);
	}
	for (const [id, ctx] of contexts) {
		peers.set(id, await wrapPeer(id, ctx));
		await enableUnloadNow(ctx, options.unloadModels === true);
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
			await Promise.all(
				[...peers.values()].map((peer) => waitForPeerIdle(peer.ctx)),
			);
		},
		/**
		 * Brings target peers up to the source peer's state through its CRDT
		 * batches (the real sync path), not through a graph snapshot.
		 */
		async syncFromPeer(sourceId: MiniCutPeerId, targetIds?: MiniCutPeerId[]) {
			const source = peers.get(sourceId);
			if (!source)
				throw new Error(`Unknown MiniCut maelstrom peer: ${sourceId}`);
			for (const id of targetIds ?? [...peers.keys()].filter((id) => id !== sourceId)) {
				if (!peers.has(id)) throw new Error(`Unknown MiniCut maelstrom peer: ${id}`);
			}
			await waitForPeerIdle(source.ctx);
			source.flushOutbound();
			await network.deliverAll({ reorder: false });
			await Promise.all(
				[...peers.values()].map((peer) => waitForPeerIdle(peer.ctx)),
			);
		},
		async reinitPeer(id: MiniCutPeerId) {
			const current = peers.get(id);
			if (!current) throw new Error(`Unknown MiniCut maelstrom peer: ${id}`);
			const snapshot = await readDurableOrLiveSnapshot(current.ctx, options);
			if (!snapshot)
				throw new Error(`MiniCut maelstrom peer ${id} has no snapshot`);
			// Keep the durable storage package open: this simulates an app/runtime
			// restart over the same store handle. Closing the package would close
			// IndexedDB/LevelDB itself, making the reused test storage invalid.
			// The graph snapshot is paired with this peer's own CRDT storage.
			const ctx = await createPeer(id, network, options, outgoingHistory, {
				snapshot,
				storagePackage: current.ctx.storagePackage ?? resolveStorage(options, id),
				preferredProjectId: String(current.project._node_id),
			});
			const restarted = await wrapPeer(id, ctx);
			peers.set(id, restarted);
			await enableUnloadNow(ctx, options.unloadModels === true);
			return restarted;
		},
	};
};
