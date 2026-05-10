import type { DktTestContext } from '../testingInit'
import { bootDktModels, getAttr, queryRel } from '../testingInit'

export type ModelHandle = DktTestContext['sessionRoot']

export type ActionContractHarness = {
	ctx: DktTestContext
	sessionRoot: ModelHandle
	project: ModelHandle
	videoTrack: ModelHandle
	audioTrack: ModelHandle
	videoResource: ModelHandle
	audioResource: ModelHandle
	imageResource: ModelHandle
	videoClip: ModelHandle
	audioClip: ModelHandle
	exportRequests: unknown[]
	importRequests: unknown[]
}

type HarnessOptions = {
	interfaces?: Record<string, unknown>
}

const resolveModelBySourceId = async (
	ctx: DktTestContext,
	scope: ModelHandle,
	relName: string,
	sourceAttr: string,
	sourceId: string,
): Promise<ModelHandle> => {
	const models = await queryRel(scope, relName)
	const match = models.find((model) => getAttr(model, sourceAttr) === sourceId)
	if (!match) {
		throw new Error(`Expected ${relName} model ${sourceAttr}=${sourceId}`)
	}
	return match
}

export const dispatchAndSettle = async (
	ctx: DktTestContext,
	scope: ModelHandle,
	actionName: string,
	payload?: unknown,
): Promise<void> => {
	await ctx.lockToRead(async () => {
		await scope.dispatch(actionName, payload)
	})
}

export const readSourceIds = async (
	ctx: DktTestContext,
	scope: ModelHandle,
	relName: string,
	sourceAttr: string,
): Promise<string[]> => {
	const models = await queryRel(scope, relName)
	return models.map((model) => String(getAttr(model, sourceAttr)))
}

export const findBySourceId = async (
	ctx: DktTestContext,
	scope: ModelHandle,
	relName: string,
	sourceAttr: string,
	sourceId: string,
): Promise<ModelHandle | null> => {
	const models = await queryRel(scope, relName)
	return models.find((model) => getAttr(model, sourceAttr) === sourceId) ?? null
}

export const createActionContractHarness = async (options: HarnessOptions = {}): Promise<ActionContractHarness> => {
	const exportRequests: unknown[] = []
	const importRequests: unknown[] = []
	const userInterfaces = options.interfaces ?? {}
	const userExportRuntime = (userInterfaces as { exportRuntime?: { requestExport?: (payload: unknown) => unknown } }).exportRuntime
	const userImportRuntime = (userInterfaces as { importRuntime?: { requestImportFiles?: (payload: unknown) => unknown } }).importRuntime

	const ctx = await bootDktModels({
		interfaces: {
			...userInterfaces,
			exportRuntime: {
				...userExportRuntime,
				requestExport(payload: unknown) {
					exportRequests.push(payload)
					return userExportRuntime?.requestExport?.(payload)
				},
			},
			importRuntime: {
				...userImportRuntime,
				requestImportFiles(payload: unknown) {
					importRequests.push(payload)
					return userImportRuntime?.requestImportFiles?.(payload)
				},
			},
		},
	})

	await dispatchAndSettle(ctx, ctx.sessionRoot, 'createProject', {
		sourceProjectId: 'coverage-project',
		title: 'Coverage Project',
		fps: 30,
		width: 1920,
		height: 1080,
		duration: 12,
	})

	const project = (await queryRel(ctx.sessionRoot, 'activeProject'))[0]
	if (!project) {
		throw new Error('Expected active project after createProject')
	}

	const tracks = await queryRel(project, 'tracks')
	const videoTrack = tracks.find((track) => getAttr(track, 'kind') === 'video')
	const audioTrack = tracks.find((track) => getAttr(track, 'kind') === 'audio')
	if (!videoTrack || !audioTrack) {
		throw new Error('Expected default video/audio tracks')
	}

	await dispatchAndSettle(ctx, project, 'importResource', {
		sourceResourceId: 'res:video',
		name: 'Video Resource',
		kind: 'video',
		url: 'https://example.invalid/video.webm',
		mime: 'video/webm',
		duration: 10,
		size: 1000,
		source: { kind: 'local' },
		status: 'ready',
		data: { status: 'ready' },
	})

	await dispatchAndSettle(ctx, project, 'importResource', {
		sourceResourceId: 'res:audio',
		name: 'Audio Resource',
		kind: 'audio',
		url: 'https://example.invalid/audio.wav',
		mime: 'audio/wav',
		duration: 8,
		size: 800,
		source: { kind: 'local' },
		status: 'ready',
		data: { status: 'ready' },
	})

	await dispatchAndSettle(ctx, project, 'importResource', {
		sourceResourceId: 'res:image',
		name: 'Image Resource',
		kind: 'image',
		url: 'https://example.invalid/image.png',
		mime: 'image/png',
		duration: 6,
		size: 600,
		source: { kind: 'local' },
		status: 'ready',
		data: { status: 'ready' },
	})

	await dispatchAndSettle(ctx, videoTrack, 'addClip', {
		sourceClipId: 'clip:video',
		sourceResourceId: 'res:video',
		name: 'Video Clip',
		mediaKind: 'video',
		start: 1,
		in: 0,
		duration: 4,
	})

	await dispatchAndSettle(ctx, audioTrack, 'addClip', {
		sourceClipId: 'clip:audio',
		sourceResourceId: 'res:audio',
		name: 'Audio Clip',
		mediaKind: 'audio',
		start: 0,
		in: 0,
		duration: 3,
	})

	return {
		ctx,
		sessionRoot: ctx.sessionRoot,
		project,
		videoTrack,
		audioTrack,
		videoResource: await resolveModelBySourceId(ctx, project, 'resources', 'sourceResourceId', 'res:video'),
		audioResource: await resolveModelBySourceId(ctx, project, 'resources', 'sourceResourceId', 'res:audio'),
		imageResource: await resolveModelBySourceId(ctx, project, 'resources', 'sourceResourceId', 'res:image'),
		videoClip: await resolveModelBySourceId(ctx, videoTrack, 'clips', 'sourceClipId', 'clip:video'),
		audioClip: await resolveModelBySourceId(ctx, audioTrack, 'clips', 'sourceClipId', 'clip:audio'),
		exportRequests,
		importRequests,
	}
}
