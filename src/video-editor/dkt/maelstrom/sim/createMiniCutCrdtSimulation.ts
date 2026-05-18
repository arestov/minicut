import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { queryAddr } from "dkt/async/queryAddr.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
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
	queryVideoClips: () => Promise<RuntimeModel[]>;
};

export type MiniCutConflictSummary = {
	openModelConflicts: number;
	openTimelineConflicts: number;
	openTimingConflicts: number;
};

const PROFILE_ID = "minicut-crdt-v1";
const PROFILE_VERSION = 1;

const findModel = (ctx: DktTestContext, nodeId: string): RuntimeModel => {
	if (String(ctx.appModel._node_id) === nodeId) return ctx.appModel;
	const runtimeModel = (ctx.runtime as { models?: Record<string, RuntimeModel> }).models?.[nodeId];
	if (runtimeModel) return runtimeModel;
	const sessionModel = getModelById(ctx.sessionRoot, nodeId) as RuntimeModel | null;
	if (!sessionModel) {
		throw new Error(`MiniCut maelstrom model was not found: ${nodeId}`);
	}
	return sessionModel;
};

const receiveNetworkMessage = async (
	ctx: DktTestContext,
	message: MiniCutNetworkMessage,
) => {
	const pending = [...(message.packet.ops ?? [])];
	while (pending.length > 0) {
		const nextPending = [];
		let applied = 0;
		const opsByNode = new Map<string, unknown[]>();
		for (const op of pending) {
			const nodeId = (op as { node_id?: unknown } | null)?.node_id;
			if (typeof nodeId !== "string" || !nodeId) {
				throw new Error("MiniCut maelstrom received op without node_id");
			}
			try {
				findModel(ctx, nodeId);
			} catch {
				nextPending.push(op);
				continue;
			}
			const ops = opsByNode.get(nodeId) ?? [];
			ops.push(op);
			opsByNode.set(nodeId, ops);
		}
		for (const [nodeId, ops] of opsByNode) {
			await ctx.runtime.crdt_runtime?.receiveCanonicalOps?.(findModel(ctx, nodeId), ops);
			applied += ops.length;
		}
		if (nextPending.length === 0) {
			break;
		}
		if (applied === 0) {
			const ids = nextPending
				.map((op) => (op as { node_id?: unknown } | null)?.node_id)
				.filter(Boolean)
				.join(", ");
			throw new Error(`MiniCut maelstrom could not materialize incoming CRDT nodes: ${ids}`);
		}
		pending.splice(0, pending.length, ...nextPending);
	}
	await ctx.storagePackage?.commitChanges?.({
		reason: "minicut-maelstrom-receive",
	});
	await waitForRuntimeIdle(ctx);
};

const attrNumber = (model: RuntimeModel, attrName: string): number => Number(model.states?.[attrName] ?? 0);

const queryVideoTrackClips = async (
	ctx: DktTestContext,
	videoTrack: RuntimeModel,
): Promise<RuntimeModel[]> => {
	const clipsFromRel = await ctx.queryRel(videoTrack, "clips");
	if (clipsFromRel.length > 0) return clipsFromRel;
	const snapshot = await (
		ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot?.();
	const snapshotClipRefs =
		((snapshot as { models?: Record<string, { rels?: Record<string, unknown> }> } | null)
			?.models?.[String(videoTrack._node_id)]?.rels?.clips);
	if (Array.isArray(snapshotClipRefs) && snapshotClipRefs.length > 0) {
		return snapshotClipRefs
			.map((item) => {
				const id =
					typeof item === "string"
						? item
						: String((item as { _node_id?: unknown } | null)?._node_id ?? "");
				const model = id
					? ((ctx.runtime as { models?: Record<string, RuntimeModel> }).models?.[id] ??
						(getModelById(ctx.appModel, id) as RuntimeModel | null))
					: null;
				return model;
			})
			.filter((item): item is RuntimeModel => Boolean(item));
	}
	const allClipsFromRel = await ctx.queryRel(ctx.appModel, "clip");
	const allClips = allClipsFromRel.length > 0
		? allClipsFromRel
		: ((await queryAddr(ctx.appModel, "<< @all:clip")) as RuntimeModel[]);
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

const findPeerProjectById = async (
	ctx: DktTestContext,
	projectId: string,
): Promise<RuntimeModel | null> => {
	const projects = await ctx.queryRel(ctx.appModel, "project");
	return projects.find((item) => String(item._node_id) === projectId) ?? null;
};

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

const documentOnlySnapshot = (snapshot: unknown): unknown => {
	if (!snapshot || typeof snapshot !== "object") return snapshot;
	const source = snapshot as {
		models?: Record<string, { model_name?: string; rels?: Record<string, unknown>; mentions?: Record<string, unknown> }>;
	};
	const models = { ...(source.models ?? {}) };
	for (const [id, model] of Object.entries(models)) {
		if (model?.model_name === "session_root") {
			delete models[id];
			continue;
		}
		if (model?.model_name === "app_root") {
			models[id] = {
				...model,
				rels: {
					...(model.rels ?? {}),
					$session_root: [],
					common_session_root: null,
					sessions: [],
					free_sessions: [],
				},
			};
		}
	}
	const validIds = new Set(Object.keys(models));
	const scrubRel = (value: unknown): unknown => {
		if (typeof value === "string") return validIds.has(value) ? value : null;
		if (Array.isArray(value)) {
			return value.filter((item) => typeof item !== "string" || validIds.has(item));
		}
		if (value && typeof value === "object" && "_node_id" in value) {
			const id = String((value as { _node_id?: unknown })._node_id ?? "");
			return validIds.has(id) ? value : null;
		}
		return value;
	};
	for (const [id, model] of Object.entries(models)) {
		const nextModel = { ...model };
		if (model?.rels) {
			const nextRels: Record<string, unknown> = {};
			for (const [name, value] of Object.entries(model.rels)) {
				nextRels[name] = scrubRel(value);
			}
			nextModel.rels = nextRels;
		}
		if (model?.mentions) {
			const nextMentions: Record<string, unknown> = {};
			for (const [name, value] of Object.entries(model.mentions)) {
				nextMentions[name] = scrubRel(value);
			}
			nextModel.mentions = nextMentions;
		}
		models[id] = nextModel;
	}
	const nextSnapshot = {
		...snapshot,
		models,
		expected_rels_to_chains: {},
	};
	const missingRefs: string[] = [];
	const scan = (value: unknown, path: string) => {
		if (missingRefs.length > 10) return;
		if (typeof value === "string") {
			if (value.startsWith("crdt:") && !validIds.has(value)) {
				missingRefs.push(`${path} -> ${value}`);
			}
			return;
		}
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			value.forEach((item, index) => scan(item, `${path}[${index}]`));
			return;
		}
		for (const [key, item] of Object.entries(value)) {
			scan(item, `${path}.${key}`);
		}
	};
	scan(nextSnapshot, "snapshot");
	if (missingRefs.length > 0) {
		throw new Error(`MiniCut document snapshot has missing refs:\n${missingRefs.join("\n")}`);
	}
	return nextSnapshot;
};

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
				createExpectedRel?: (key: string, data: unknown) => Promise<unknown> | unknown;
				putProjectMeta?: (meta: unknown) => Promise<unknown> | unknown;
				commitChanges?: (meta?: unknown) => Promise<unknown> | unknown;
		  }
		| undefined;
	if (!dktStorage?.createModel) return;
	const raw = snapshot as {
		models?: Record<string, {
			attrs?: Record<string, unknown>;
			model_name?: string;
			rels?: Record<string, unknown>;
			mentions?: Record<string, unknown> | null;
		}>;
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
	await dktStorage.commitChanges?.({ reason });
};

const enableUnloadNow = async (ctx: DktTestContext, enabled: boolean) => {
	if (!enabled) return;
	const runtime = ctx.runtime as {
		enableUnload?: () => void;
	};
	runtime.enableUnload?.();
	await waitForRuntimeIdle(ctx);
};

const seedBaselineOps = async (
	storagePackage: DktTestContext["storagePackage"],
	ops: unknown[],
) => {
	if (!storagePackage || ops.length === 0) return;
	const crdtStorage = storagePackage.crdtStorage as {
		appendOps?: (ops: unknown[]) => void;
		markApplied?: (opIds: string[]) => void;
		commitChanges?: (meta?: unknown) => Promise<unknown> | unknown;
	};
	crdtStorage.appendOps?.(ops);
	crdtStorage.markApplied?.(
		ops
			.map((op) => (op as { op_id?: unknown } | null)?.op_id)
			.filter((id): id is string => typeof id === "string"),
	);
	await crdtStorage.commitChanges?.({ reason: "minicut-maelstrom-baseline" });
};

const isRuntimeModel = (value: unknown): value is RuntimeModel =>
	Boolean(value && typeof value === "object" && "_node_id" in value);

const baselineClock = (counter: number) => ({
	wall_time: 1,
	counter,
	peer_id: "baseline",
});

const synthesizeMissingAttrBaselineOps = async (
	peer: MiniCutPeer,
): Promise<unknown[]> => {
	const engine = peer.ctx.runtime.crdt_runtime as
		| {
				sidecar_state?: {
					read?: (nodeId: string, fieldId: string) => unknown;
				};
		  }
		| undefined;
	const models = Object.values(
		(peer.ctx.runtime as { models?: Record<string, RuntimeModel> }).models ?? {},
	).filter(isRuntimeModel);
	const ops: unknown[] = [];
	let counter = 0;
	for (const model of models) {
		const nodeId = String(model._node_id ?? "");
		if (!nodeId) continue;
		const meta = model.constructor?.prototype?.__crdt_meta as
			| {
					enabled_fields?: Array<{
						field_id?: string;
						kind?: string;
						model_name?: string;
						name?: string;
					}>;
			  }
			| undefined;
		for (const field of meta?.enabled_fields ?? []) {
			if (field.kind !== "attr") continue;
			const fieldId = field.field_id;
			const name = field.name;
			if (!fieldId || !name) continue;
			if (engine?.sidecar_state?.read?.(nodeId, fieldId)) continue;
			const value = await peer.ctx.queryAttr(model, name);
			if (value == null) continue;
			counter += 1;
			ops.push({
				op_id: `baseline:${peer.id}:${nodeId}:${fieldId}`,
				origin: "baseline",
				peer_id: peer.id,
				clock: baselineClock(counter),
				node_id: nodeId,
				model_name: field.model_name ?? model.model_name,
				field_id: fieldId,
				kind: "attr",
				name,
				operation: "set",
				value,
			});
		}
	}
	if (ops.length > 0) {
		await seedBaselineOps(peer.ctx.storagePackage, ops);
		await peer.ctx.runtime.crdt_runtime?.restoreFromStorage?.();
		drainCrdtOutbox(peer.ctx.runtime);
		await waitForRuntimeIdle(peer.ctx);
	}
	return ops;
};

const readDurableOrLiveSnapshot = async (
	ctx: DktTestContext,
	options: SimulationOptions,
): Promise<unknown> => {
	if (options.unloadModels !== true) {
		return toReinitableData(ctx.runtime);
	}
	const durableSnapshot = await (
		ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot?.();
	return durableSnapshot ?? await toReinitableData(ctx.runtime);
};

const wrapPeer = async (
	id: MiniCutPeerId,
	ctx: DktTestContext,
	network: DeterministicMiniCutNetwork,
): Promise<MiniCutPeer> => {
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected active project");
	const tracksFromRel = await ctx.queryRel(project, "tracks");
	const tracksFromAddr = (await queryAddr(project, "<< @all:tracks")) as RuntimeModel[];
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
		throw new Error(`Expected video and audio tracks: ${JSON.stringify({
			project: project._node_id,
			tracksFromRel: tracksFromRel.length,
			tracksFromAddr: tracksFromAddr.length,
			projectRels: (project as { rels?: Record<string, unknown> }).rels,
			tracks: trackKinds.map((item) => ({
				id: item.track?._node_id,
				modelName: item.track?.model_name,
				kind: item.kind,
			})),
		})}`);
	}

	network.registerPeer(id, (message) => receiveNetworkMessage(ctx, message));

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
			const clips = await queryVideoTrackClips(ctx, videoTrack);
			return clips.map((clip) => String(clip._node_id));
		},
		async queryVideoClips() {
			return queryVideoTrackClips(ctx, videoTrack);
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
	snapshot?: unknown,
	storagePackage?: MiniCutDktCrdtStorageOptions,
	preferredProjectId?: string,
): Promise<DktTestContext> => {
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
			transport: null,
		},
	});
	if (snapshot) {
		await seedGraphStorageFromSnapshot(
			ctx,
			snapshot,
			"minicut-maelstrom-seed-snapshot",
		);
		await ctx.lockToRead(async () => {
			const rawProjects = (await queryAddr(ctx.sessionRoot, "<< @all:pioneer.project")) as Array<RuntimeModel | string>;
			const projects = rawProjects
				.map((project) =>
					typeof project === "string"
						? getModelById(ctx.appModel, project)
						: project,
				)
				.filter((project): project is RuntimeModel => Boolean(project && typeof project === "object" && "_node_id" in project));
			const projectKinds = await Promise.all(
				projects.map(async (project) => ({
					project,
					title: await ctx.queryAttr(project, "title"),
				})),
			);
			const project =
				(preferredProjectId
					? await findPeerProjectById(ctx, preferredProjectId)
					: null) ??
				projectKinds.find((item) => item.title === "MiniCut maelstrom project")
					?.project ?? projects[0];
			if (!project) throw new Error("Expected shared project in MiniCut maelstrom snapshot");
			await ctx.sessionRoot.dispatch("syncActiveProjectRel", { project });
		});
	}
	await waitForRuntimeIdle(ctx);
	await ctx.storagePackage?.commitChanges?.({
		reason: snapshot
			? "minicut-maelstrom-bootstrap-snapshot"
			: "minicut-maelstrom-bootstrap",
	});
	drainCrdtOutbox(ctx.runtime);
	network.registerPeer(id, (message) => receiveNetworkMessage(ctx, message));
	return ctx;
};

const createProjectOnPrimary = async (
	primaryId: MiniCutPeerId,
	contexts: Map<MiniCutPeerId, DktTestContext>,
) => {
	const primary = contexts.get(primaryId);
	if (!primary) throw new Error(`Missing primary MiniCut maelstrom peer: ${primaryId}`);
	await primary.lockToRead(async () => {
		await primary.sessionRoot.dispatch("createProject", {
			title: "MiniCut maelstrom project",
			fps: 30,
			width: 1920,
			height: 1080,
			duration: 12,
		});
	});
	await waitForRuntimeIdle(primary);
	drainCrdtOutbox(primary.runtime);
	const project = (await primary.queryRel(primary.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected primary project after bootstrap");
};

export const createMiniCutCrdtSimulation = async (options: SimulationOptions) => {
	const network = new DeterministicMiniCutNetwork();
	const peers = new Map<MiniCutPeerId, MiniCutPeer>();
	const contexts = new Map<MiniCutPeerId, DktTestContext>();
	const snapshots = new Map<MiniCutPeerId, unknown>();
	const primaryId = options.peers[0];
	if (!primaryId) throw new Error("MiniCut maelstrom requires at least one peer");
	const primaryCtx = await createPeer(primaryId, network, options);
	contexts.set(primaryId, primaryCtx);
	await createProjectOnPrimary(primaryId, contexts);
	const bootstrapSnapshot = await (
		primaryCtx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot?.();
	if (!bootstrapSnapshot) throw new Error("MiniCut maelstrom primary peer has no bootstrap snapshot");
	for (const id of options.peers.slice(1)) {
		const snapshot = documentOnlySnapshot(bootstrapSnapshot);
		snapshots.set(id, snapshot);
		contexts.set(id, await createPeer(
			id,
			network,
			options,
			snapshot,
			undefined,
			String((await primaryCtx.queryRel(primaryCtx.sessionRoot, "activeProject"))[0]?._node_id ?? ""),
		));
	}
	for (const [id, ctx] of contexts) {
		peers.set(id, await wrapPeer(id, ctx, network));
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
			await Promise.all([...peers.values()].map((peer) => waitForRuntimeIdle(peer.ctx)));
		},
		async syncFromPeer(sourceId: MiniCutPeerId, targetIds?: MiniCutPeerId[]) {
			const source = peers.get(sourceId);
			if (!source) throw new Error(`Unknown MiniCut maelstrom peer: ${sourceId}`);
			await waitForRuntimeIdle(source.ctx);
			await source.ctx.storagePackage?.commitChanges?.({
				reason: "minicut-maelstrom-sync-source",
			});
			const baselineOps = drainCrdtOutbox(source.ctx.runtime);
			const syntheticBaselineOps = await synthesizeMissingAttrBaselineOps(source);
			const snapshot = await readDurableOrLiveSnapshot(source.ctx, options);
			if (!snapshot) throw new Error(`MiniCut maelstrom peer ${sourceId} has no snapshot`);
			const ids = targetIds ?? [...peers.keys()].filter((id) => id !== sourceId);
			for (const id of ids) {
				const current = peers.get(id);
				if (!current) throw new Error(`Unknown MiniCut maelstrom peer: ${id}`);
				const storagePackage = resolveStorage(options, id);
				const targetSnapshot = documentOnlySnapshot(snapshot);
				const ctx = await createPeer(
					id,
					network,
					options,
					targetSnapshot,
					storagePackage,
					String(source.project._node_id),
				);
				await seedBaselineOps(ctx.storagePackage, [
					...baselineOps,
					...syntheticBaselineOps,
				]);
				await ctx.runtime.crdt_runtime?.restoreFromStorage?.();
				const synced = await wrapPeer(id, ctx, network);
				peers.set(id, synced);
				snapshots.set(id, targetSnapshot);
				await enableUnloadNow(ctx, options.unloadModels === true);
			}
		},
		async reinitPeer(id: MiniCutPeerId) {
			const current = peers.get(id);
			if (!current) throw new Error(`Unknown MiniCut maelstrom peer: ${id}`);
			const snapshot = await readDurableOrLiveSnapshot(current.ctx, options) ?? snapshots.get(id);
			if (!snapshot) throw new Error(`MiniCut maelstrom peer ${id} has no snapshot`);
			// Keep the durable storage package open: this simulates an app/runtime
			// restart over the same store handle. Closing the package would close
			// IndexedDB/LevelDB itself, making the reused test storage invalid.
			const ctx = await bootDktModels({
				aggregateValidation: "error",
				unloadModels: false,
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
			await seedGraphStorageFromSnapshot(
				ctx,
				snapshot,
				"minicut-maelstrom-reinit-seed-snapshot",
			);
			await ctx.lockToRead(async () => {
				const project =
					await findPeerProjectById(ctx, String(current.project._node_id)) ??
					getModelById(ctx.appModel, String(current.project._node_id));
				if (project) {
					await ctx.sessionRoot.dispatch("syncActiveProjectRel", { project });
				}
			});
			const restarted = await wrapPeer(id, ctx, network);
			peers.set(id, restarted);
			snapshots.set(id, snapshot);
			await enableUnloadNow(ctx, options.unloadModels === true);
			return restarted;
		},
	};
};
