import { createEffectContractFakes, type EffectContractFakes } from "./effectContractFakes";
import { createInMemoryCrdtRelay } from "../crdt/createInMemoryCrdtRelay";
import { createTestWorkerCrdtTransport } from "../crdt/createTestWorkerCrdtTransport";
import { bootDktModels, type BootDktModelsOptions, type DktTestContext } from "../testingInit";
import type { DktCrdtTransport } from "../crdt/testRelayContracts";
import { waitForRuntimeIdle } from "./waitForRuntimeIdle";
import { runDktStorageRequest, type DktStorageRequest } from "../storage/dktStorageRequest";

type RuntimeModel = DktTestContext["sessionRoot"];
type PeerId = "A" | "B";

type PeerRuntime = {
	id: PeerId;
	ctx: DktTestContext;
	effects: EffectContractFakes;
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
	App?: BootDktModelsOptions["App"];
	roomId: string;
	profileId: string;
	profileVersion: number;
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

const queryVideoTrackClips = async (
	ctx: DktTestContext,
	videoTrack: RuntimeModel,
): Promise<RuntimeModel[]> => {
	const clips = await ctx.queryRel(videoTrack, "clips");
	if (clips.length > 0) return clips;
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

const bootPeerContext = async (
	peerId: PeerId,
	transport: DktCrdtTransport,
	effects: EffectContractFakes,
	App?: BootDktModelsOptions["App"],
): Promise<DktTestContext> =>
	bootDktModels({
		App,
		interfaces: effects.interfaces as unknown as Record<string, unknown>,
		crdt: {
			enabled: true,
			peerId,
			storage: "memory",
			transport,
		},
	});

const wrapPeer = async (peerId: PeerId, ctx: DktTestContext, effects: EffectContractFakes): Promise<PeerRuntime> => {
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

	return {
		id: peerId,
		ctx,
		effects,
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
	const effectsA = createEffectContractFakes(); const effectsB = createEffectContractFakes();
	const ctxA = await bootPeerContext("A", transportA, effectsA, options.App);
	await ctxA.lockToRead(async () => {
		await ctxA.sessionRoot.dispatch("createProject", {
			title: "CRDT worker pair project",
		});
	});
	await waitForRuntimeIdle(ctxA);
	// Peer B joins like a real second device: it starts with an empty graph and
	// receives A's CRDT history (outgoing batches) through the relay. It never
	// gets a graph snapshot without CRDT history.
	(ctxA.runtime.crdt_runtime as { flushTransportOutbox?: () => unknown } | null)
		?.flushTransportOutbox?.();
	const projectA = (await ctxA.queryRel(ctxA.sessionRoot, "activeProject"))[0];
	if (!projectA) throw new Error("Expected source project");
	const ctxB = await bootPeerContext("B", transportB, effectsB, options.App);
	transportB.requestSync("crdt-worker-pair-bootstrap");
	await (
		ctxB.runtime.crdt_runtime as { transport_receive_tail?: Promise<unknown> } | null
	)?.transport_receive_tail;
	await waitForRuntimeIdle(ctxB);
	await bindPeerProject(ctxB, await findSharedProject(ctxB, String(projectA._node_id)));
	const a = await wrapPeer("A", ctxA, effectsA);
	const b = await wrapPeer("B", ctxB, effectsB);

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
		partition() {
			transportA.setDeliveryPaused(true);
			transportB.setDeliveryPaused(true);
		},
		heal() {
			transportA.setDeliveryPaused(false);
			transportB.setDeliveryPaused(false);
			transportA.flushBufferedMessages();
			transportB.flushBufferedMessages();
		},
		async waitForConvergence() {
			await waitForTransport();
			await waitForRuntimeIdle(a.ctx);
			await waitForRuntimeIdle(b.ctx);
			await waitForTransport();
		},
		close() {
			transportA.close?.();
			transportB.close?.();
		},
	};
};
