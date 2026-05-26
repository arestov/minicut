import type { DktTestContext } from "../testingInit";
import { bootDktModels, getAttr, queryRel } from "../testingInit";

export type ModelHandle = DktTestContext["sessionRoot"];

export type ActionContractHarness = {
	ctx: DktTestContext;
	sessionRoot: ModelHandle;
	project: ModelHandle;
	videoTrack: ModelHandle;
	audioTrack: ModelHandle;
	videoResource: ModelHandle;
	audioResource: ModelHandle;
	imageResource: ModelHandle;
	videoClip: ModelHandle;
	audioClip: ModelHandle;
	exportRequests: unknown[];
	importRequests: unknown[];
};

type HarnessOptions = {
	interfaces?: Record<string, unknown>;
};

const resolveModelByNodeId = async (
	_ctx: DktTestContext,
	scope: ModelHandle,
	relName: string,
	nodeId: string,
): Promise<ModelHandle> => {
	const models = await queryRel(scope, relName);
	const match = models.find((model) => model?._node_id === nodeId);
	if (!match) {
		throw new Error(`Expected ${relName} model _node_id=${nodeId}`);
	}
	return match;
};

export const dispatchAndSettle = async (
	ctx: DktTestContext,
	scope: ModelHandle,
	actionName: string,
	payload?: unknown,
): Promise<void> => {
	await ctx.lockToRead(async () => {
		await scope.dispatch(actionName, payload);
	});
};

export const readNodeIds = async (
	_ctx: DktTestContext,
	scope: ModelHandle,
	relName: string,
): Promise<string[]> => {
	const models = await queryRel(scope, relName);
	return models.map((model) => String(model?._node_id));
};

export const findByNodeId = async (
	_ctx: DktTestContext,
	scope: ModelHandle,
	relName: string,
	nodeId: string,
): Promise<ModelHandle | null> => {
	const models = await queryRel(scope, relName);
	return models.find((model) => model?._node_id === nodeId) ?? null;
};

export const createActionContractHarness = async (
	options: HarnessOptions = {},
): Promise<ActionContractHarness> => {
	const exportRequests: unknown[] = [];
	const importRequests: unknown[] = [];
	const userInterfaces = options.interfaces ?? {};
	const userExportRuntime = (
		userInterfaces as {
			exportRuntime?: { requestExport?: (payload: unknown) => unknown };
		}
	).exportRuntime;
	const userImportRuntime = (
		userInterfaces as {
			importRuntime?: { requestImportFiles?: (payload: unknown) => unknown };
		}
	).importRuntime;

	const ctx = await bootDktModels({
		interfaces: {
			...userInterfaces,
			exportRuntime: {
				...userExportRuntime,
				requestExport(payload: unknown) {
					exportRequests.push(payload);
					return userExportRuntime?.requestExport?.(payload);
				},
			},
			importRuntime: {
				...userImportRuntime,
				requestImportFiles(payload: unknown) {
					importRequests.push(payload);
					return userImportRuntime?.requestImportFiles?.(payload);
				},
			},
		},
	});

	await dispatchAndSettle(ctx, ctx.sessionRoot, "createProject", {
		title: "Coverage Project",
		fps: 30,
		width: 1920,
		height: 1080,
		duration: 12,
	});

	const project = (await queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) {
		throw new Error("Expected active project after createProject");
	}

	const tracks = await queryRel(project, "tracks");
	const videoTrack = tracks.find((track) => getAttr(track, "kind") === "video");
	const audioTrack = tracks.find((track) => getAttr(track, "kind") === "audio");
	if (!videoTrack || !audioTrack) {
		throw new Error("Expected default video/audio tracks");
	}

	await dispatchAndSettle(ctx, project, "importResource", {
		name: "Video Resource",
		kind: "video",
		url: "https://example.invalid/video.webm",
		mime: "video/webm",
		duration: 10,
		size: 1000,
		source: { kind: "local" },
		status: "ready",
		data: { status: "ready" },
	});

	await dispatchAndSettle(ctx, project, "importResource", {
		name: "Audio Resource",
		kind: "audio",
		url: "https://example.invalid/audio.wav",
		mime: "audio/wav",
		duration: 8,
		size: 800,
		source: { kind: "local" },
		status: "ready",
		data: { status: "ready" },
	});

	await dispatchAndSettle(ctx, project, "importResource", {
		name: "Image Resource",
		kind: "image",
		url: "https://example.invalid/image.png",
		mime: "image/png",
		duration: 6,
		size: 600,
		source: { kind: "local" },
		status: "ready",
		data: { status: "ready" },
	});

	const resources = await queryRel(project, "resources");
	const videoResource = resources.find(
		(resource) => getAttr(resource, "name") === "Video Resource",
	);
	const audioResource = resources.find(
		(resource) => getAttr(resource, "name") === "Audio Resource",
	);
	const imageResource = resources.find(
		(resource) => getAttr(resource, "name") === "Image Resource",
	);
	if (!videoResource || !audioResource || !imageResource) {
		throw new Error("Expected imported resources");
	}

	await dispatchAndSettle(ctx, videoTrack, "addClip", {
		resource: videoResource,
		name: "Video Clip",
		mediaKind: "video",
		start: 1,
		in: 0,
		duration: 4,
	});

	await dispatchAndSettle(ctx, audioTrack, "addClip", {
		resource: audioResource,
		name: "Audio Clip",
		mediaKind: "audio",
		start: 0,
		in: 0,
		duration: 3,
	});

	const videoClip = (await queryRel(videoTrack, "clips")).find(
		(clip) => getAttr(clip, "name") === "Video Clip",
	);
	const audioClip = (await queryRel(audioTrack, "clips")).find(
		(clip) => getAttr(clip, "name") === "Audio Clip",
	);
	if (!videoClip || !audioClip) {
		throw new Error("Expected seeded clips");
	}

	return {
		ctx,
		sessionRoot: ctx.sessionRoot,
		project,
		videoTrack,
		audioTrack,
		videoResource: await resolveModelByNodeId(
			ctx,
			project,
			"resources",
			String(videoResource._node_id),
		),
		audioResource: await resolveModelByNodeId(
			ctx,
			project,
			"resources",
			String(audioResource._node_id),
		),
		imageResource: await resolveModelByNodeId(
			ctx,
			project,
			"resources",
			String(imageResource._node_id),
		),
		videoClip: await resolveModelByNodeId(
			ctx,
			videoTrack,
			"clips",
			String(videoClip._node_id),
		),
		audioClip: await resolveModelByNodeId(
			ctx,
			audioTrack,
			"clips",
			String(audioClip._node_id),
		),
		exportRequests,
		importRequests,
	};
};
