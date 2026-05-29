import { chromium, expect, test, type Page } from '@playwright/test'

const installOpfsPicker = async (page: Page) => {
	await page.addInitScript(async () => {
		const root = await navigator.storage.getDirectory()
		const handle = await root.getFileHandle('picked-handle-video.webm', { create: true })
		const writable = await handle.createWritable()
		await writable.write(new Blob(['not-a-real-webm'], { type: 'video/webm' }))
		await writable.close()
		Object.defineProperty(window, 'showOpenFilePicker', {
			value: async () => [handle],
			configurable: true,
		})
	})
}

const setTimelineCursor = async (page: Page, seconds: number): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const laneBox = await laneScroll.boundingBox()
	if (!laneBox) throw new Error('Timeline lane scroll area is unavailable')
	await laneScroll.click({ position: { x: Math.max(8, seconds * zoom), y: Math.max(12, laneBox.height - 12) } })
}

test('single mode restores handle-backed media and persists post-restore edits', async ({ baseURL }, testInfo) => {
	const userDataDir = testInfo.outputPath('single-mode-handle-profile')
	const context = await chromium.launchPersistentContext(userDataDir, {
		baseURL,
		headless: true,
	})
	const page = context.pages()[0] ?? await context.newPage()
	await installOpfsPicker(page)

	try {
		await page.goto('/')
		await page.getByLabel('Media bin').locator('.ve-import-button').click()
		const mediaBin = page.getByLabel('Media bin')
		const handleResourceRow = mediaBin.locator('.ve-resource-row').filter({ hasText: 'picked-handle-video.webm' })
		await expect(handleResourceRow).toContainText('ready', { timeout: 20_000 })

		const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(1)
		await timeline.getByRole('button', { name: /picked-handle-video\.webm/i }).first().click()
		await setTimelineCursor(page, 0.5)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(2)

		await page.reload()
		await expect(handleResourceRow).toContainText('ready', { timeout: 20_000 })
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(2)

		await timeline.getByRole('button', { name: /picked-handle-video\.webm/i }).nth(1).click()
		await setTimelineCursor(page, 0.75)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(3)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Nudge +0.5s' }).click()

		await page.reload()
		await expect(handleResourceRow).toContainText('ready', { timeout: 20_000 })
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(3)
	} finally {
		await context.close()
	}
})
