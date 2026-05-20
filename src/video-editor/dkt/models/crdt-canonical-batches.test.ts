import { describe, expect, it } from "vitest";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { bootDktModels, type MiniCutDktCrdtRuntime } from "../testingInit";
import { drainCrdtOutboxBatches } from "../test/crdtAssertions";

type TestModel = Awaited<ReturnType<typeof bootDktModels>>["sessionRoot"];
type CanonicalBatch = {
	created_models?: readonly { node_id?: unknown; model_name?: unknown }[];
	ops?: readonly {
		kind?: unknown;
		name?: unknown;
		node_id?: unknown;
		model_name?: unknown;
		value?: unknown;
	}[];
	action_trace?: unknown;
};

const bootCrdtModels = async (peerId: string) => {
	const ctx = await bootDktModels({
		crdt: { enabled: true, peerId, storage: "memory", transport: null },
	});
	drainCrdtOutboxBatches(ctx.runtime);
	return ctx;
};

const dispatchAndDrain = async (
	ctx: Awaited<ReturnType<typeof bootDktModels>>,
	target: TestModel,
	actionName: string,
	payload?: unknown,
): Promise<CanonicalBatch[]> => {
	await ctx.lockToRead(async () => {
		await target.dispatch(actionName, payload);
	});
	return drainCrdtOutboxBatches(ctx.runtime) as CanonicalBatch[];
};

const jsonRoundTrip = <T,>(value: T): T =>
	JSON.parse(JSON.stringify(value)) as T;

const allCreated = (batches: readonly CanonicalBatch[]) =>
	batches.flatMap((batch) => batch.created_models ?? []);

const allOps = (batches: readonly CanonicalBatch[]) =>
	batches.flatMap((batch) => batch.ops ?? []);

const createdIds = (batches: readonly CanonicalBatch[], modelName: string) =>
	allCreated(batches)
		.filter((record) => record.model_name === modelName)
		.map((record) => String(record.node_id));

const expectRelOp = (
	batches: readonly CanonicalBatch[],
	partial: { model_name?: string; name: string; node_id?: string },
) => {
	expect(allOps(batches)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "rel", ...partial }),
		]),
	);
};

const expectAttrOp = (
	batches: readonly CanonicalBatch[],
	partial: { model_name?: string; name: string; value?: unknown },
) => {
	expect(allOps(batches)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "attr", ...partial }),
		]),
	);
};

const receiveBatches = async (
	ctx: Awaited<ReturnType<typeof bootDktModels>>,
	batches: readonly CanonicalBatch[],
) => {
	for (const batch of jsonRoundTrip(batches)) {
		await ctx.lockToRead(async () => {
			await (ctx.runtime.crdt_runtime as MiniCutDktCrdtRuntime).receiveCanonicalBatch?.(
				ctx.appModel,
				batch,
			);
		});
	}
};

const findProjectByTitle = async (
	ctx: Awaited<ReturnType<typeof bootDktModels>>,
	title: string,
) => {
	const projects = await ctx.queryRel(ctx.appModel, "project");
	for (const project of projects) {
		if ((await ctx.queryAttr(project, "title")) === title) {
			return project;
		}
	}
	return null;
};

const getReceivedModel = (
	ctx: Awaited<ReturnType<typeof bootDktModels>>,
	nodeId: unknown,
) => {
	const model = getModelById(ctx.appModel, String(nodeId)) as TestModel | null;
	if (!model) {
		throw new Error(`Expected received model ${String(nodeId)}`);
	}
	return model;
};

const trackByKind = async (
	ctx: Awaited<ReturnType<typeof bootDktModels>>,
	project: TestModel,
	kind: string,
) => {
	const tracks = await ctx.queryRel(project, "tracks");
	for (const track of tracks) {
		if ((await ctx.queryAttr(track, "kind")) === kind) {
			return track;
		}
	}
	return null;
};

const createProject = async (
	ctx: Awaited<ReturnType<typeof bootDktModels>>,
	title: string,
) => {
	const batches = await dispatchAndDrain(ctx, ctx.sessionRoot, "createProject", {
		title,
		autoCreateDefaultTracks: true,
	});
	const project = await findProjectByTitle(ctx, title);
	if (!project) throw new Error(`Expected project ${title}`);
	const videoTrack = await trackByKind(ctx, project, "video");
	const audioTrack = await trackByKind(ctx, project, "audio");
	if (!videoTrack || !audioTrack) {
		throw new Error("Expected default video and audio tracks");
	}
	return { batches, project, videoTrack, audioTrack };
};

describe("MiniCut canonical CRDT batches", () => {
	it("creates default project tracks as canonical graph state", async () => {
		const sender = await bootCrdtModels("canonical-project-a");
		const { batches, project } = await createProject(sender, "Canonical project");

		expect(createdIds(batches, "project")).toContain(String(project._node_id));
		expect(createdIds(batches, "track")).toHaveLength(2);
		expectRelOp(batches, { model_name: "app_root", name: "project", node_id: "ROOT" });
		expectRelOp(batches, { model_name: "project", name: "tracks", node_id: String(project._node_id) });
		expectRelOp(batches, { model_name: "project", name: "primaryVideoTrack", node_id: String(project._node_id) });
		expectRelOp(batches, { model_name: "project", name: "primaryAudioTrack", node_id: String(project._node_id) });
		expectRelOp(batches, { model_name: "track", name: "project" });
		expect(batches.some((batch) => batch.action_trace)).toBe(true);
		expect(JSON.stringify(batches)).not.toContain("read_fingerprints");

		const receiver = await bootCrdtModels("canonical-project-b");
		await receiveBatches(receiver, batches);
		await receiveBatches(receiver, batches);

		const receivedProject = getReceivedModel(receiver, project._node_id);
		expect(receiver.getAttr(receivedProject, "title")).toBe("Canonical project");
		expect(await trackByKind(receiver, receivedProject, "video")).toBeTruthy();
		expect(await trackByKind(receiver, receivedProject, "audio")).toBeTruthy();

		await sender.close();
		await receiver.close();
	});

	it("imports a video resource and adds video plus embedded audio clips canonically", async () => {
		const sender = await bootCrdtModels("canonical-video-a");
		const projectSetup = await createProject(sender, "Canonical video project");
		const projectBatches = projectSetup.batches;
		const importBatches = await dispatchAndDrain(sender, projectSetup.project, "importResource", {
			name: "Canonical Video",
			kind: "video",
			url: "https://example.invalid/canonical.webm",
			mime: "video/webm",
			duration: 5,
			size: 500,
			source: { kind: "local" },
			status: "ready",
			data: { status: "ready" },
		});
		const resources = await sender.queryRel(projectSetup.project, "resources");
		const resource = resources.find((item) => sender.getAttr(item, "name") === "Canonical Video");
		if (!resource) throw new Error("Expected imported resource");
		const timelineBatches = await dispatchAndDrain(
			sender,
			projectSetup.project,
			"addResourceToTimeline",
			resource._node_id,
		);
		const batches = [...projectBatches, ...importBatches, ...timelineBatches];

		expect(createdIds(importBatches, "resource")).toContain(String(resource._node_id));
		expect(createdIds(timelineBatches, "clip")).toHaveLength(2);
		expectRelOp(timelineBatches, { model_name: "track", name: "clips" });
		expectRelOp(timelineBatches, { model_name: "clip", name: "resource" });
		expectRelOp(timelineBatches, { model_name: "clip", name: "track" });
		expectRelOp(timelineBatches, { model_name: "clip", name: "project" });
		expectAttrOp(timelineBatches, { model_name: "clip", name: "mediaKind", value: "audio" });

		const receiver = await bootCrdtModels("canonical-video-b");
		await receiveBatches(receiver, batches);
		const receivedProject = getReceivedModel(receiver, projectSetup.project._node_id);
		expect(receiver.getAttr(receivedProject, "title")).toBe("Canonical video project");
		const videoTrack = await trackByKind(receiver, receivedProject, "video");
		const audioTrack = await trackByKind(receiver, receivedProject, "audio");
		expect(await receiver.queryRel(videoTrack as TestModel, "clips")).toHaveLength(1);
		expect(await receiver.queryRel(audioTrack as TestModel, "clips")).toHaveLength(1);

		await sender.close();
		await receiver.close();
	});

	it("creates text clip and text node as canonical graph state", async () => {
		const sender = await bootCrdtModels("canonical-text-a");
		const projectSetup = await createProject(sender, "Canonical text project");
		const textBatches = await dispatchAndDrain(sender, projectSetup.project, "addTextClipToVideoTrack", {
			name: "Canonical Text Clip",
			mediaKind: "text",
			start: 4,
			in: 0,
			duration: 2,
			text: {
				content: "Canonical text",
				style: { fontFamily: "Inter", fontSize: 40, color: "#ffffff" },
				box: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 },
			},
		});
		const batches = [...projectSetup.batches, ...textBatches];

		expect(createdIds(textBatches, "clip")).toHaveLength(1);
		expect(createdIds(textBatches, "text")).toHaveLength(1);
		expectRelOp(textBatches, { model_name: "clip", name: "text" });
		expectRelOp(textBatches, { model_name: "text", name: "clip" });
		expectRelOp(textBatches, { model_name: "track", name: "clips" });
		expectAttrOp(textBatches, { model_name: "text", name: "content", value: "Canonical text" });

		const receiver = await bootCrdtModels("canonical-text-b");
		await receiveBatches(receiver, batches);
		const receivedProject = getReceivedModel(receiver, projectSetup.project._node_id);
		expect(receiver.getAttr(receivedProject, "title")).toBe("Canonical text project");
		const videoTrack = await trackByKind(receiver, receivedProject, "video");
		const clips = await receiver.queryRel(videoTrack as TestModel, "clips");
		const textClip = clips.find((clip) => receiver.getAttr(clip, "name") === "Canonical Text Clip");
		if (!textClip) throw new Error("Expected received text clip");
		const textNodes = await receiver.queryRel(textClip, "text");
		expect(receiver.getAttr(textNodes[0], "content")).toBe("Canonical text");

		await sender.close();
		await receiver.close();
	});
});
