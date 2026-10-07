import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { fixturePath, launchMiniCut, type LaunchedMiniCut } from './launchMiniCut'

test.describe.configure({ mode: 'serial' })

const setTimelineCursor = async (page: Page, seconds: number): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const laneBox = await laneScroll.boundingBox()
	if (!laneBox) {
		throw new Error('Timeline lane scroll area is unavailable')
	}
	await laneScroll.click({
		position: {
			x: Math.max(8, seconds * zoom),
			y: Math.max(12, laneBox.height - 12),
		},
	})
}

const previewVideo = (page: Page) => page.locator('.ve-renderer video').first()

const importClip = async (page: Page): Promise<void> => {
	await page.locator('input[type=file]').first().setInputFiles(fixturePath('clip-4s.webm'))
	await expect(previewVideo(page)).toBeAttached()
}

const whenMetadataLoaded = (page: Page) =>
	previewVideo(page).evaluate(async (video: HTMLVideoElement) => {
		if (video.readyState < 1) {
			await new Promise<void>((resolve) =>
				video.addEventListener('loadedmetadata', () => resolve(), { once: true }),
			)
		}
		return { duration: video.duration, src: video.currentSrc }
	})

test.describe('Electron renderer, configuration B', () => {
	let mini: LaunchedMiniCut

	test.beforeEach(async () => {
		mini = await launchMiniCut()
	})
	test.afterEach(async () => {
		await mini.close()
	})

	test('imports a file through the host asset protocol instead of a blob URL', async () => {
		await importClip(mini.page)

		const { duration, src } = await whenMetadataLoaded(mini.page)

		expect(src.startsWith('minicut://local/asset/')).toBe(true)
		expect(duration).toBeGreaterThan(3.5)
		await expect(mini.page.getByLabel('Media bin')).toContainText('clip-4s.webm')
		await expect
			.poll(async () => (await mini.assetRequests()).some((request) => request.status === 206))
			.toBe(true)
	})

	test('seeks the preview from the timeline over range requests', async () => {
		await importClip(mini.page)
		await whenMetadataLoaded(mini.page)

		await setTimelineCursor(mini.page, 2.5)

		await expect
			.poll(() => previewVideo(mini.page).evaluate((video: HTMLVideoElement) => video.currentTime))
			.toBeCloseTo(2.5, 1)
		const seekableEnd = await previewVideo(mini.page).evaluate((video: HTMLVideoElement) =>
			video.seekable.length > 0 ? video.seekable.end(0) : 0,
		)
		expect(seekableEnd).toBeGreaterThan(3.5)
		const requests = await mini.assetRequests()
		expect(requests.length).toBeGreaterThan(0)
		expect(requests.filter((request) => request.status === 206).length).toBeGreaterThan(0)
		expect(requests.every((request) => request.range?.startsWith('bytes='))).toBe(true)
	})

	test('exports the imported clip in the media service and writes a WebM file', async () => {
		await importClip(mini.page)
		await whenMetadataLoaded(mini.page)

		await mini.page.getByRole('banner').getByRole('button', { name: 'Export project' }).click()

		// The window only shows the outcome; the file is written by the media service.
		const status = mini.page.getByRole('banner').getByRole('status')
		await expect(status).toContainText('Export ready', { timeout: 60_000 })
		const files = fs.readdirSync(mini.exportDir).filter((name) => name.endsWith('.webm'))
		expect(files).toHaveLength(1)
		const bytes = fs.readFileSync(`${mini.exportDir}/${files[0]}`)
		expect(bytes.length).toBeGreaterThan(1000)
		expect(Array.from(bytes.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3])
	})

	test('serves the renderer under a CSP and denies new windows and foreign navigation', async () => {
		const csp = await mini.page.evaluate(async () =>
			(await fetch(location.href)).headers.get('content-security-policy'),
		)
		expect(csp).toContain("default-src 'self'")
		expect(csp).toContain("object-src 'none'")

		const opened = await mini.page.evaluate(() => window.open('https://example.com/') !== null)
		expect(opened).toBe(false)
		expect(mini.app.windows()).toHaveLength(1)

		await mini.page.evaluate(() => {
			location.href = 'https://example.com/'
		})
		expect(mini.page.url().startsWith('minicut://local/app/')).toBe(true)
	})
})
