import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { createInMemoryCrdtRelay } from "../crdt/createInMemoryCrdtRelay";
import { sanitizeStorageValue } from "../crdt/sanitizeStoragePackage";
import { createTestWorkerCrdtTransport } from "../crdt/createTestWorkerCrdtTransport";
import type { MiniCutCrdtRelayMessage } from "../crdt/testRelayContracts";
import {
	bootDktModels,
	type DktTestContext,
	type MiniCutDktCrdtStoragePackage,
} from "../testingInit";
import { drainCrdtOutbox, drainCrdtOutboxBatches } from "./crdtAssertions";
import { waitForRuntimeIdle } from "./waitForRuntimeIdle";

type RuntimeModel = DktTestContext["sessionRoot"];
type PeerId = "A" | "B";

type PeerRuntime = {
	id: PeerId;
	ctx: DktTestContext;
	project: RuntimeModel;
	videoTrack: RuntimeModel;
	dispatch: (
		target: RuntimeModel,
		actionName: string,
		payload?: unknown,
		meta?: unknown,
	) => Promise<void>;
	flushOutbound: () => void;
	readProjectTitle: () => Promise<unknown>;
	readVideoClipIds: () => Promise<string[]>;
	queryVideoClips: () => Promise<RuntimeModel[]>;
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
	await waitForRuntimeIdle(ctx);
	const batches = message.packet.batches ?? [];
	if (batches.length > 0) {
		for (const batch of batches) {
			const receiver =
				ctx.runtime.crdt_runtime?.testing?.receiveFromNetwork ??
				ctx.runtime.crdt_runtime?.receiveCanonicalBatch;
			await receiver?.(ctx.appModel, cloneBatch(batch));
			await ctx.storagePackage?.commitChanges?.({
				reason: `minicut-worker-pair-receive:${
					(batch as { batch_id?: unknown } | null)?.batch_id ?? "batch"
				}`,
			});
			await waitForRuntimeIdle(ctx);
		}
		return;
	}
	const ops = message.packet.ops ?? [];
	if (ops.length > 0) {
		throw new Error("MiniCut CRDT worker pair delivery requires graph batches");
	}
};

const receiveLegacyOpsForTests = async (
	ctx: DktTestContext,
	ops: unknown[],
) => {
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

const cloneBatch = (batch: unknown): unknown => {
	if (!batch || typeof batch !== "object") return batch;
	return {
		...(batch as Record<string, unknown>),
		created_models: [
			...((batch as { created_models?: unknown[] }).created_models ?? []),
		],
		tombstones: [...((batch as { tombstones?: unknown[] }).tombstones ?? [])],
		ops: ((batch as { ops?: unknown[] }).ops ?? []).map((op) =>
			op && typeof op === "object" ? { ...(op as Record<string, unknown>) } : op,
		),
	};
};

const findSharedProject = async (
	ctx: DktTestContext,
	preferredProjectId?: string,
): Promise<RuntimeModel> => {
	const projects = await ctx.queryRel(ctx.appModel, "project");
	const projectKinds = await Promise.all(
		projects.map(async (project) => ({
			project,
			title: await ctx.queryAttr(project, "title"),
		})),
	);
	const project =
		(preferredProjectId
			? projects.find((item) => String(item._node_id) === preferredProjectId)
			: null) ??
		projectKinds.find((item) => item.title === "CRDT worker pair project")
			?.project ?? projects[0];
	if (!project) {
		throw new Error("Expected shared project");
	}
	return project;
};

const readDurableOrLiveSnapshot = async (ctx: DktTestContext): Promise<unknown> => {
	const durableSnapshot = await (
		ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot?.();
	return durableSnapshot ?? await toReinitableData(ctx.runtime);
};

const queryVideoTrackClips = async (
	ctx: DktTestContext,
	videoTrack: RuntimeModel,
): Promise<RuntimeModel[]> => {
	const clips = await ctx.queryRel(videoTrack, "clips");
	if (clips.length > 0) return clips;
	const snapshot = await (
		ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot?.();
	const snapshotClipRefs =
		(snapshot as { models?: Record<string, { rels?: Record<string, unknown> }> } | null)
			?.models?.[String(videoTrack._node_id)]?.rels?.clips;
	if (Array.isArray(snapshotClipRefs) && snapshotClipRefs.length > 0) {
		return snapshotClipRefs
			.map((item) => {
				const id =
					typeof item === "string"
						? item
						: String((item as { _node_id?: unknown } | null)?._node_id ?? "");
				return id
					? ((ctx.runtime as { models?: Record<string, RuntimeModel> }).models?.[id] ??
						(getModelById(ctx.appModel, id) as RuntimeModel | null))
					: null;
			})
			.filter((item): item is RuntimeModel => Boolean(item));
	}
	const allClips = await ctx.queryRel(ctx.appModel, "clip");
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

const bindPeerProject = async (ctx: DktTestContext, project: RuntimeModel) => {
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("syncActiveProjectRel", { project });
	});
};

const createPeer = async (
	peerId: PeerId,
	options: {
		snapshot?: unknown;
		storagePackage?: MiniCutDktCrdtStoragePackage | null;
		preferredProjectId?: string;
		transport?: unknown;
	} = {},
): Promise<PeerRuntime> => {
	const ctx = await bootDktModels({
		reinitFromSnapshot: options.snapshot,
		crdt: {
			enabled: true,
			peerId,
			storage: options.storagePackage ?? "memory",
			transport: null,
		},
	});
	if (options.snapshot) {
		await bindPeerProject(ctx, await findSharedProject(ctx, options.preferredProjectId));
	} else {
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("createProject", {
				title: "CRDT worker pair project",
			});
		});
	}
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) {
		throw new Error("Expected active project");
	}
	const tracks = await ctx.queryRel(project, "tracks");
	const trackKinds = await Promise.all(
		tracks.map(async (track) => ({
			track,
			kind: await ctx.queryAttr(track, "kind"),
		})),
	);
	const videoTrack = trackKinds.find((item) => item.kind === "video")?.track;
	if (!videoTrack) {
		throw new Error("Expected video track");
	}
	drainCrdtOutboxBatches(ctx.runtime);
	drainCrdtOutbox(ctx.runtime);
	if (options.transport) {
		(ctx.runtime.crdt_runtime as {
			attachTransport?: (transport: unknown, options: { baseModel: RuntimeModel }) => void;
		} | null)?.attachTransport?.(options.transport, { baseModel: ctx.appModel });
	}

	return {
		id: peerId,
		ctx,
		project,
		videoTrack,
		async dispatch(target, actionName, payload, meta) {
			await ctx.lockToRead(async () => {
				await target.dispatch(actionName, payload, null, meta);
			});
		},
		flushOutbound() {
			const runtime = ctx.runtime.crdt_runtime as
				| { flushTransportOutbox?: () => unknown }
				| null
				| undefined;
			runtime?.flushTransportOutbox?.();
		},
		async readProjectTitle() {
			return ctx.queryAttr(project, "title");
		},
		async readVideoClipIds() {
			return (await queryVideoTrackClips(ctx, videoTrack)).map((clip) =>
				String(clip._node_id),
			);
		},
		async queryVideoClips() {
			return queryVideoTrackClips(ctx, videoTrack);
		},
	};
};

const seedBaselineOps = async (
	storagePackage: MiniCutDktCrdtStoragePackage | null,
	ops: unknown[],
) => {
	if (!storagePackage || ops.length === 0) return;
	const crdtStorage = storagePackage.crdtStorage as {
		appendBatches?: (batches: unknown[]) => void;
		markBatchesApplied?: (batchIds: string[]) => void;
		commitChanges?: (meta?: unknown) => Promise<unknown> | unknown;
	};
	const batch = {
		schema_version: 1,
		batch_id: `baseline:${ops
			.map((op) => (op as { op_id?: unknown } | null)?.op_id)
			.filter(Boolean)
			.join(":")}`,
		origin_peer_id: "baseline",
		runtime_transaction_id: null,
		intent: null,
		clock: (ops.at(-1) as { clock?: unknown } | null)?.clock ?? null,
		created_models: [],
		tombstones: [],
		ops: ops.map((op) =>
			op && typeof op === "object" ? { ...(op as Record<string, unknown>) } : op,
		),
	};
	crdtStorage.appendBatches?.([batch]);
	crdtStorage.markBatchesApplied?.([batch.batch_id]);
	await crdtStorage.commitChanges?.({ reason: "minicut-worker-pair-baseline" });
};

const isRuntimeModel = (value: unknown): value is RuntimeModel =>
	Boolean(value && typeof value === "object" && "_node_id" in value);

const baselineClock = (counter: number) => ({
	wall_time: 1,
	counter,
	peer_id: "baseline",
});

const synthesizeMissingAttrBaselineOps = async (
	peer: PeerRuntime,
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
			const value = sanitizeStorageValue(await peer.ctx.queryAttr(model, name));
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

const replacePeerFromSnapshot = async (
	target: PeerRuntime,
	source: PeerRuntime,
	ops: unknown[],
) => {
	await source.ctx.storagePackage?.commitChanges?.({
		reason: "minicut-worker-pair-sync-source",
	});
	const snapshot = await readDurableOrLiveSnapshot(source.ctx);
	const storagePackage = target.ctx.storagePackage;
	await target.ctx.close();
	await seedBaselineOps(storagePackage, ops);
	const next = await createPeer(target.id, {
		snapshot,
		storagePackage,
		preferredProjectId: String(source.project._node_id),
	});
	Object.assign(target, next);
};

export const createCrdtWorkerPair = async (options: Options) => {
	const relay = createInMemoryCrdtRelay();
	const transportA = createTestWorkerCrdtTransport({
		relay,
		roomId: options.roomId,
		peerId: "A",
		profileId: options.profileId,
		profileVersion: options.profileVersion,
	});
	const transportB = createTestWorkerCrdtTransport({
		relay,
		roomId: options.roomId,
		peerId: "B",
		profileId: options.profileId,
		profileVersion: options.profileVersion,
	});
	const a = await createPeer("A", { transport: transportA });
	const b = await createPeer("B", {
		transport: transportB,
		snapshot: await readDurableOrLiveSnapshot(a.ctx),
		preferredProjectId: String(a.project._node_id),
	});

	const waitForTransport = async () => {
		await Promise.all([
			(a.ctx.runtime.crdt_runtime as { transport_receive_tail?: Promise<unknown> } | null)
				?.transport_receive_tail,
			(b.ctx.runtime.crdt_runtime as { transport_receive_tail?: Promise<unknown> } | null)
				?.transport_receive_tail,
		]);
	};

	return {
		a,
		b,
		relay,
		transportA,
		transportB,
		async waitForConvergence() {
			await waitForTransport();
			await waitForRuntimeIdle(a.ctx);
			await waitForRuntimeIdle(b.ctx);
			await waitForTransport();
		},
		async syncBaselineFrom(sourceId: PeerId = "A") {
			const source = sourceId === "A" ? a : b;
			const target = sourceId === "A" ? b : a;
			const ops = drainCrdtOutbox(source.ctx.runtime);
			const batches = drainCrdtOutboxBatches(source.ctx.runtime);
			const syntheticBaselineOps = await synthesizeMissingAttrBaselineOps(source);
			for (const batch of batches) {
				await receiveOps(target.ctx, {
					type: "crdt-ops",
					roomId: options.roomId,
					from: source.id,
					packet: {
						profileId: options.profileId,
						profileVersion: options.profileVersion,
						peerId: source.id,
						batches: [batch],
					},
				});
			}
			if (ops.length > 0) {
				await receiveLegacyOpsForTests(target.ctx, ops);
			}
			await replacePeerFromSnapshot(target, source, [
				...ops,
				...syntheticBaselineOps,
			]);
		},
		close() {
			transportA.close();
			transportB.close();
		},
	};
};
