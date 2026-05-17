import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { createInMemoryCrdtRelay } from "../crdt/createInMemoryCrdtRelay";
import { createTestWorkerCrdtTransport } from "../crdt/createTestWorkerCrdtTransport";
import type { MiniCutCrdtRelayMessage } from "../crdt/testRelayContracts";
import {
	bootDktModels,
	type DktTestContext,
	type MiniCutDktCrdtStoragePackage,
} from "../testingInit";
import { drainCrdtOutbox } from "./crdtAssertions";
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

const findSharedProject = async (ctx: DktTestContext): Promise<RuntimeModel> => {
	const projects = await ctx.queryRel(ctx.appModel, "project");
	const projectKinds = await Promise.all(
		projects.map(async (project) => ({
			project,
			title: await ctx.queryAttr(project, "title"),
		})),
	);
	const project =
		projectKinds.find((item) => item.title === "CRDT worker pair project")
			?.project ?? projects[0];
	if (!project) {
		throw new Error("Expected shared project");
	}
	return project;
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
		await bindPeerProject(ctx, await findSharedProject(ctx));
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
	drainCrdtOutbox(ctx.runtime);

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
		flushOutbound() {},
		async readProjectTitle() {
			return ctx.queryAttr(project, "title");
		},
		async readVideoClipIds() {
			return (await ctx.queryRel(videoTrack, "clips")).map((clip) =>
				String(clip._node_id),
			);
		},
	};
};

const seedBaselineOps = async (
	storagePackage: MiniCutDktCrdtStoragePackage | null,
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
	await crdtStorage.commitChanges?.({ reason: "minicut-worker-pair-baseline" });
};

const replacePeerFromSnapshot = async (
	target: PeerRuntime,
	source: PeerRuntime,
	ops: unknown[],
) => {
	const snapshot = await toReinitableData(source.ctx.runtime);
	const storagePackage = target.ctx.storagePackage;
	await target.ctx.close();
	await seedBaselineOps(storagePackage, ops);
	const next = await createPeer(target.id, { snapshot, storagePackage });
	Object.assign(target, next);
};

export const createCrdtWorkerPair = async (options: Options) => {
	const relay = createInMemoryCrdtRelay();
	const a = await createPeer("A");
	const b = await createPeer("B", {
		snapshot: await toReinitableData(a.ctx.runtime),
	});

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
		async syncBaselineFrom(sourceId: PeerId = "A") {
			const source = sourceId === "A" ? a : b;
			const target = sourceId === "A" ? b : a;
			const ops = drainCrdtOutbox(source.ctx.runtime);
			await replacePeerFromSnapshot(target, source, ops);
		},
		close() {
			transportA.close();
			transportB.close();
		},
	};
};
