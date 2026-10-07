import { expect, test, type Download, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureFixtures } from '../../src/video-editor/media/node/testing/mediaFixtures'
import { probeFile } from '../../src/video-editor/media/node/ffprobe'

/**
 * Shared export scenario, web half: import the shared VP9/Opus fixture, export
 * the project through the web app (WebCodecs path) and keep the produced file.
 * The Node half and the comparison are added on top of this helper.
 */

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

test.describe('web vs node export parity', () => {
	test.describe.configure({ timeout: 180_000, mode: 'serial' })

	test('web export of the shared scenario is a decodable A/V WebM', async ({ page }) => {
		const fixtures = await ensureFixtures(['video-av-webm'])
		const webPath = await exportSharedScenarioFromWeb(page, fixtures['video-av-webm'])
		const info = await probeFile('web', webPath, { ffprobePath, countFrames: true })
		console.log('WEB-EXPORT', JSON.stringify({ path: webPath, format: info.formatName, duration: info.durationSeconds, video: info.video, audio: info.audio }))
		expect(info.video).not.toBeNull()
		expect(info.audio).not.toBeNull()
		expect(info.durationSeconds).toBeGreaterThan(1.5)
	})
})
