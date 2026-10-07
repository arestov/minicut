import fs from 'node:fs'
import path from 'node:path'
import { startMediaServiceProcess } from '../../src/video-editor/hosts/electron/main/mediaServiceProcess'
import { scenarioAssets, videoAudioScenario } from '../../src/video-editor/media/node/testing/exportScenarios'
import type { Electron, HarnessCtx } from './_harness/desktopDriver'

type Ctx = HarnessCtx

type Params = {
	scenario: string
	fixtures: Record<string, string>
	outDir: string
	/** Asset id served by the stub registry in main. */
	assetId: string
	assetPath: string
	ffmpegPath?: string
}

const startService = async (electron: Electron, ctx: Ctx, params: Params) =>
	startMediaServiceProcess({
		utilityProcess: electron.utilityProcess as never,
		entryPath: path.join(ctx.distRoot, 'utility', 'mediaService.mjs'),
		assets: {
			resolve: (assetId) =>
				assetId === params.assetId
					? { ok: true, location: { path: params.assetPath } }
					: { ok: false, error: { code: 'asset-not-found', message: assetId } },
		},
	})

const scenarios = {
	/** Probe by asset id (resolved in main), export a short plan, report what was written. */
	async probeAndExport({ electron, ctx, params }: { electron: Electron; ctx: Ctx; params: Params }) {
		const media = await startService(electron, ctx, params)
		try {
			const info = await media.service.probe({
				requestId: 'probe',
				source: { assetId: params.assetId },
			})
			const fingerprint = await media.service.fingerprint(params.assetPath)
			const job = media.service.exportPlan({
				requestId: 'electron-export',
				plan: videoAudioScenario.plan,
				range: { type: 'project' },
				outputPath: path.join(params.outDir, 'electron-export.webm'),
				assets: scenarioAssets(videoAudioScenario, params.fixtures as never),
			})
			const stages = new Set<string>()
			job.onProgress((event) => stages.add(event.stage))
			const outcome = await job.outcome
			await media.dispose()
			return {
				width: info.video?.width ?? 0,
				fingerprintVersion: fingerprint.version,
				stages: [...stages],
				outcome,
				exists: fs.existsSync(path.join(params.outDir, 'electron-export.webm')),
			}
		} finally {
			await media.dispose()
		}
	},

	/** Cancel a long export: the service kills ffmpeg and removes its files. */
	async cancelExport({ electron, ctx, params }: { electron: Electron; ctx: Ctx; params: Params }) {
		const media = await startService(electron, ctx, params)
		try {
			const job = media.service.exportPlan({
				requestId: 'electron-cancel',
				plan: { ...videoAudioScenario.plan, duration: 120, width: 1280, height: 720 },
				range: { type: 'project' },
				outputPath: path.join(params.outDir, 'electron-cancel.webm'),
				assets: scenarioAssets(videoAudioScenario, params.fixtures as never),
				width: 1280,
				height: 720,
			})
			await new Promise<void>((resolve) => {
				job.onProgress((event) => {
					if (event.stage === 'rendering' && event.ratio > 0) resolve()
				})
			})
			job.cancel()
			const outcome = await job.outcome
			const left = fs
				.readdirSync(params.outDir)
				.filter((name) => name.includes('electron-cancel'))
			return { outcome, left }
		} finally {
			await media.dispose()
		}
	},

	/** A missing ffmpeg is a start error, not a service that fails later. */
	async missingFfmpeg({ electron, ctx, params }: { electron: Electron; ctx: Ctx; params: Params }) {
		process.env.MINICUT_FFMPEG_PATH = 'minicut-no-such-ffmpeg'
		try {
			await startService(electron, ctx, params)
			return { started: true, code: null, message: null }
		} catch (error) {
			const info = (error as { info?: { code?: string } }).info
			return { started: false, code: info?.code ?? null, message: (error as Error).message }
		} finally {
			delete process.env.MINICUT_FFMPEG_PATH
		}
	},
}

export const run = async ({ electron, ctx }: { electron: Electron; ctx: Ctx }) => {
	const params = ctx.params as unknown as Params
	const scenario = (scenarios as Record<string, typeof scenarios.probeAndExport>)[params.scenario]
	if (!scenario) throw new Error(`unknown scenario ${params.scenario}`)
	return scenario({ electron, ctx, params })
}
