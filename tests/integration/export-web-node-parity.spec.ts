import { expect, test, type Download, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureFixtures } from '../../src/video-editor/media/node/testing/mediaFixtures'
import { probeFile } from '../../src/video-editor/media/node/ffprobe'
import { createMediaService } from '../../src/video-editor/media/node/mediaService'
import { scenarioAssets, webCompareScenario, webLayeringScenario, webLayeringTimeline } from '../../src/video-editor/media/node/testing/exportScenarios'
import { audioStats, centerRgbAt, compareFrameAt, integratedLoudness, meanLumaAt } from '../../src/video-editor/media/node/testing/mediaMetrics'

/**
 * Differential export check. The web app imports the shared VP9/Opus fixture
 * and exports the project (WebCodecs path); the Node media service renders the
 * equivalent plan with FFmpeg at the geometry/fps the web app chose. Both files
 * are compared via ffprobe metadata, SSIM/PSNR of frames at fixed timestamps and
 * audio RMS / integrated loudness.
 */

// Explicit tolerances for web (WebCodecs VP8 + browser scaling) vs node (FFmpeg VP9 + swscale).
// Measured on the reference machine: SSIM 0.978-0.987 (0.949 on flat black frames: the web encoder lifts black to RGB ~9, node writes 0), PSNR 31.8-37.6 dB, RMS delta 0.07 dB, LUFS delta 0.1.
const SSIM_MIN = 0.94
const PSNR_MIN_DB = 30
const RMS_TOLERANCE_DB = 1
const LUFS_TOLERANCE = 1

const ffprobePath = process.env.MINICUT_FFPROBE_PATH ?? 'ffprobe'

const createProjectFromMenu = async (page: Page): Promise<void> => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible({ timeout: 20_000 })
}

const persistDownload = async (download: Download): Promise<string> => {
	const failure = await download.failure()
	if (failure) {
		throw new Error(`Download failed: ${failure}`)
	}
	const folder = await mkdtemp(join(tmpdir(), 'minicut-parity-'))
	const filePath = join(folder, download.suggestedFilename() || 'web-export.webm')
	await download.saveAs(filePath)
	await expect.poll(
		async () => (await readFile(filePath).catch(() => Buffer.alloc(0))).length,
		{ message: 'web export file is non-empty', timeout: 5_000 },
	).toBeGreaterThan(0)
	return filePath
}

const exportProjectFromWeb = async (page: Page): Promise<string> => {
	const exportButton = page.getByRole('button', { name: 'Export project' })
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
		await exportButton.click()
		try {
			return await persistDownload(await downloadPromise)
		} catch (error) {
			if (attempt === 2) {
				throw error
			}
			await expect(exportButton).toBeEnabled({ timeout: 120_000 })
		}
	}
	throw new Error('unreachable')
}

export const exportSharedScenarioFromWeb = async (page: Page, fixturePath: string): Promise<string> => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await page.getByLabel('Import media files').setInputFiles({
		name: 'scenario-av.webm',
		mimeType: 'video/webm',
		buffer: await readFile(fixturePath),
	})
	const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
	await expect(timeline.getByRole('button', { name: /scenario-av\.webm/i }).first()).toBeVisible({ timeout: 45_000 })
	await expect(timeline.getByRole('button', { name: /Embedded audio/i })).toBeVisible()

	return exportProjectFromWeb(page)
}

const selectClipByName = async (page: Page, name: string): Promise<void> => {
	await page.evaluate(async (clipName) => {
		const debug = (window as Window & { __MINICUT_P2P_DEBUG__?: any }).__MINICUT_P2P_DEBUG__
		const id = debug.getActiveProjectTracks().flatMap((t: any) => t.clips ?? []).find((c: any) => c.name === clipName)?.clipId
		if (!id) {
			throw new Error(`Unable to find clip ${clipName}`)
		}
		await debug.dispatchRootAction('selectEntity', String(id))
	}, name)
	await expect(page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }).first()).toHaveClass(/is-selected/)
}

const readWebTimeline = async (page: Page): Promise<Array<[string, string, number, number, number]>> =>
	page.evaluate(() => {
		const state = (window as Window & { __MINICUT_P2P_DEBUG__?: any }).__MINICUT_P2P_DEBUG__.dumpProjectState()
		return state.tracks.flatMap((track: any) => track.clips
			.filter((clip: any) => clip.attrs.name !== 'Embedded audio')
			.map((clip: any): [string, string, number, number, number] => [track.attrs.name, clip.attrs.name, clip.attrs.start, clip.attrs.in, clip.attrs.duration]))
	})

/** Builds the layering/trim/mono timeline through the web UI (see webLayeringScenario). */
const buildLayeringScenarioInWeb = async (page: Page, paths: Record<'av' | 'blue' | 'tone', string>): Promise<void> => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await page.getByLabel('Import media files').setInputFiles([
		{ name: 'av.webm', mimeType: 'video/webm', buffer: await readFile(paths.av) },
		{ name: 'blue.webm', mimeType: 'video/webm', buffer: await readFile(paths.blue) },
		{ name: 'tone.wav', mimeType: 'audio/wav', buffer: await readFile(paths.tone) },
	])
	const bin = page.getByLabel('Media bin').locator('.ve-resource-row')
	for (const name of ['av.webm', 'blue.webm', 'tone.wav']) {
		await expect.poll(async () => bin.filter({ hasText: name }).count(), { timeout: 45_000 }).toBeGreaterThan(0)
	}
	// Importing several files auto-places only the first video; add the rest explicitly.
	const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
	await expect(timeline.getByRole('button', { name: /av\.webm/ }).first()).toBeVisible({ timeout: 45_000 })
	for (const name of ['blue.webm', 'tone.wav']) {
		const onTimeline = timeline.getByRole('button', { name: new RegExp(name.replace('.', '\\.')) })
		if (await onTimeline.count() === 0) {
			await bin.filter({ hasText: name }).getByRole('button', { name: 'Add to timeline' }).click()
			await expect(onTimeline.first()).toBeVisible()
		}
	}

	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await selectClipByName(page, 'blue.webm')
	for (let index = 0; index < 2; index += 1) {
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Nudge -0.5s' }).click()
	}
	await selectClipByName(page, 'av.webm')
	await inspector.getByRole('tab', { name: 'Edit' }).click()
	await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
	await expect.poll(() => readWebTimeline(page)).toEqual(webLayeringTimeline)
}

test.describe('web vs node export parity', () => {
	test.describe.configure({ timeout: 180_000, mode: 'serial' })

	test('node FFmpeg export matches the web export within explicit tolerances', async ({ page }) => {
		const fixtures = await ensureFixtures(['video-av-webm'])
		const webPath = await exportSharedScenarioFromWeb(page, fixtures['video-av-webm'])
		const web = await probeFile('web', webPath, { ffprobePath, countFrames: true })
		expect(web.video).not.toBeNull()
		expect(web.audio).not.toBeNull()

		// Render the same scenario on the Node side at the geometry the web app chose.
		const outDir = await mkdtemp(join(tmpdir(), 'minicut-parity-node-'))
		const nodePath = join(outDir, 'node.webm')
		const outcome = await createMediaService().exportPlan({
			requestId: 'parity',
			plan: webCompareScenario.plan,
			range: { type: 'project' },
			format: 'webm',
			outputPath: nodePath,
			fps: web.video?.fps ?? 30,
			width: web.video?.width,
			height: web.video?.height,
			assets: scenarioAssets(webCompareScenario, fixtures),
		}).outcome
		expect(outcome.status).toBe('done')
		const node = await probeFile('node', nodePath, { ffprobePath, countFrames: true })

		const measured: Record<string, unknown> = {
			web: { w: web.video?.width, h: web.video?.height, fps: web.video?.fps, frames: web.video?.frameCount, duration: web.durationSeconds, audio: web.audio },
			node: { w: node.video?.width, h: node.video?.height, fps: node.video?.fps, frames: node.video?.frameCount, duration: node.durationSeconds, audio: node.audio },
		}

		// Metadata: identical geometry/fps; duration and frame count within one frame period + muxer slack.
		expect(node.video?.width).toBe(web.video?.width)
		expect(node.video?.height).toBe(web.video?.height)
		expect(node.video?.fps).toBeCloseTo(web.video?.fps ?? 0, 1)
		expect(Math.abs(node.durationSeconds - web.durationSeconds)).toBeLessThanOrEqual(0.1)
		expect(Math.abs((node.video?.frameCount ?? 0) - (web.video?.frameCount ?? 0))).toBeLessThanOrEqual(2)
		expect(node.audio?.sampleRate).toBe(web.audio?.sampleRate)
		expect(node.audio?.channels).toBe(web.audio?.channels)

		// Frames: structural similarity and PSNR at several timestamps.
		const frames: Array<{ at: number; ssim: number; psnr: number }> = []
		for (const at of [0.3, 1.0, 1.7]) {
			const size = { width: 480, height: 270 }
			frames.push({
				at,
				ssim: await compareFrameAt(webPath, nodePath, { at, metric: 'ssim', ...size }),
				psnr: await compareFrameAt(webPath, nodePath, { at, metric: 'psnr', ...size }),
			})
		}
		measured.frames = frames

		// Audio: level and loudness of the same 440 Hz tone.
		const [webStats, nodeStats, webLufs, nodeLufs] = await Promise.all([
			audioStats(webPath), audioStats(nodePath), integratedLoudness(webPath), integratedLoudness(nodePath),
		])
		measured.audio = { webStats, nodeStats, webLufs, nodeLufs }
		console.log('PARITY-MEASURED', JSON.stringify(measured))

		for (const frame of frames) {
			expect(frame.ssim, `SSIM at ${frame.at}s`).toBeGreaterThan(SSIM_MIN)
			expect(frame.psnr, `PSNR at ${frame.at}s`).toBeGreaterThan(PSNR_MIN_DB)
		}
		expect(Math.abs(nodeStats.rmsDb - webStats.rmsDb)).toBeLessThan(RMS_TOLERANCE_DB)
		expect(Math.abs(nodeLufs - webLufs)).toBeLessThan(LUFS_TOLERANCE)
	})

	test('layering, trim and mono audio match between web and node export', async ({ page }) => {
		const fixtures = await ensureFixtures(['video-av-webm', 'video-blue-webm', 'audio-tone'])
		await buildLayeringScenarioInWeb(page, { av: fixtures['video-av-webm'], blue: fixtures['video-blue-webm'], tone: fixtures['audio-tone'] })
		const webPath = await exportProjectFromWeb(page)
		const web = await probeFile('web', webPath, { ffprobePath, countFrames: true })

		const outDir = await mkdtemp(join(tmpdir(), 'minicut-parity-node-'))
		const nodePath = join(outDir, 'node-layering.webm')
		const outcome = await createMediaService().exportPlan({
			requestId: 'parity-layering',
			plan: webLayeringScenario.plan,
			range: { type: 'project' },
			format: 'webm',
			outputPath: nodePath,
			fps: web.video?.fps ?? 30,
			width: web.video?.width,
			height: web.video?.height,
			assets: scenarioAssets(webLayeringScenario, fixtures),
		}).outcome
		expect(outcome.status).toBe('done')
		const node = await probeFile('node', nodePath, { ffprobePath, countFrames: true })

		expect(node.video?.width).toBe(web.video?.width)
		expect(Math.abs(node.durationSeconds - web.durationSeconds)).toBeLessThanOrEqual(0.1)
		expect(Math.abs((node.video?.frameCount ?? 0) - (web.video?.frameCount ?? 0))).toBeLessThanOrEqual(2)

		// Timeline: black gap, trimmed clip alone, blue layered over it, blue alone, black tail.
		const probes = [
			{ at: 0.2, expect: 'black' },
			{ at: 0.8, expect: 'picture' },
			{ at: 1.5, expect: 'blue' },
			{ at: 2.5, expect: 'blue' },
			{ at: 3.5, expect: 'black' },
		] as const
		const measured: unknown[] = []
		for (const probe of probes) {
			const webRgb = await centerRgbAt(webPath, probe.at)
			const nodeRgb = await centerRgbAt(nodePath, probe.at)
			const ssim = await compareFrameAt(webPath, nodePath, { at: probe.at, metric: 'ssim', width: 480, height: 270 })
			const psnr = await compareFrameAt(webPath, nodePath, { at: probe.at, metric: 'psnr', width: 480, height: 270 })
			measured.push({ ...probe, webRgb, nodeRgb, ssim, psnr })
			for (const rgb of [webRgb, nodeRgb]) {
				if (probe.expect === 'blue') {
					expect(rgb[2], `blue at ${probe.at}`).toBeGreaterThan(rgb[0] + 60)
				} else if (probe.expect === 'black') {
					expect(Math.max(...rgb), `black at ${probe.at}`).toBeLessThan(40)
				}
			}
		}
		console.log('PARITY-FRAMES', JSON.stringify(measured))
		for (const frame of measured as Array<{ at: number; ssim: number; psnr: number }>) {
			expect(frame.ssim, `SSIM at ${frame.at}s`).toBeGreaterThan(SSIM_MIN)
			expect(frame.psnr, `PSNR at ${frame.at}s`).toBeGreaterThan(PSNR_MIN_DB)
		}
		expect(await meanLumaAt(nodePath, 0.8)).toBeGreaterThan(40)
		expect(await meanLumaAt(webPath, 0.8)).toBeGreaterThan(40)

		// Mono tone (4.008-7.008s): the web mixer duplicates mono to both channels at full level; so must node.
		const toneWindow = { start: 4.3, duration: 2.4 }
		const avWindow = { start: 0.3, duration: 1.5 }
		const webTone = await audioStats(webPath, toneWindow)
		const nodeTone = await audioStats(nodePath, toneWindow)
		const webAv = await audioStats(webPath, avWindow)
		const nodeAv = await audioStats(nodePath, avWindow)
		console.log('PARITY-LAYERING', JSON.stringify({ measured, webTone, nodeTone, webAv, nodeAv, web: web.video, node: node.video }))
		expect(Math.abs(nodeTone.rmsDb - webTone.rmsDb)).toBeLessThan(RMS_TOLERANCE_DB)
		expect(Math.abs(nodeAv.rmsDb - webAv.rmsDb)).toBeLessThan(RMS_TOLERANCE_DB)
	})
})
