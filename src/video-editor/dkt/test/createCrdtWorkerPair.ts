import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { createInMemoryCrdtRelay } from "../crdt/createInMemoryCrdtRelay";
import { createTestWorkerCrdtTransport } from "../crdt/createTestWorkerCrdtTransport";
import { bootDktModels, type DktTestContext } from "../testingInit";
import type { DktCrdtTransport } from "../crdt/testRelayContracts";
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

const readDurableOrLiveSnapshot = async (ctx: DktTestContext): Promise<unknown> => {
	const durableSnapshot = await (
		ctx.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
	)?.getSnapshot?.();
	return durableSnapshot ?? await toReinitableData(ctx.runtime);
};

const bootPeerContext = async (
	peerId: PeerId,
	transport: DktCrdtTransport,
	snapshot?: unknown,
): Promise<DktTestContext> =>
	bootDktModels({
		reinitFromSnapshot: snapshot,
		crdt: {
			enabled: true,
			peerId,
			storage: "memory",
			transport,
		},
	});

const wrapPeer = async (peerId: PeerId, ctx: DktTestContext): Promise<PeerRuntime> => {
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
	const ctxA = await bootPeerContext("A", transportA);
	await ctxA.lockToRead(async () => {
		await ctxA.sessionRoot.dispatch("createProject", {
			title: "CRDT worker pair project",
		});
	});
	await waitForRuntimeIdle(ctxA);
	const projectA = (await ctxA.queryRel(ctxA.sessionRoot, "activeProject"))[0];
	if (!projectA) throw new Error("Expected source project");
	const ctxB = await bootPeerContext(
		"B",
		transportB,
		await readDurableOrLiveSnapshot(ctxA),
	);
	await bindPeerProject(ctxB, await findSharedProject(ctxB, String(projectA._node_id)));
	const a = await wrapPeer("A", ctxA);
	const b = await wrapPeer("B", ctxB);

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
			transportA.close();
			transportB.close();
		},
	};
};
