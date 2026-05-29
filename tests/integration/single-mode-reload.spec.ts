import { chromium, expect, test, type Page } from '@playwright/test'

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

test('single mode restores text edits after reload without p2p harness', async ({ baseURL }, testInfo) => {
	const userDataDir = testInfo.outputPath('single-mode-profile')
	const clipName = 'Single mode caption'

	const context = await chromium.launchPersistentContext(userDataDir, {
		baseURL,
		headless: true,
	})
	const page = context.pages()[0] ?? await context.newPage()
	try {
		await page.goto('/?__minicut_test_single=1')
		await expect(page.getByRole('banner').getByRole('button', { name: 'New project' })).toBeVisible()
		await page.getByLabel('Media bin').getByRole('button', { name: 'Add Text to Timeline' }).click()

		const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
		const textClip = timeline.getByRole('button', { name: /^Resize clip start Text\b/i }).first()
		await expect(textClip).toBeVisible()
		await textClip.click()

		const inspector = page.getByRole('complementary', { name: 'Inspector' })
		await inspector.getByRole('textbox', { name: 'Clip name' }).fill(clipName)
		await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(1)

		await setTimelineCursor(page, 1)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
		await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(2)
		await timeline.getByRole('button', { name: new RegExp(clipName, 'i') }).first().click()
		await inspector.getByRole('button', { name: 'Tint' }).click()
		await expect(inspector.getByText('1 effects')).toBeVisible()

		await page.reload()
		await expect(page.getByRole('banner').getByRole('button', { name: 'New project' })).toBeVisible()

		await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(2)
		await timeline.getByRole('button', { name: new RegExp(clipName, 'i') }).nth(1).click({ position: { x: 20, y: 20 } })
		await expect(inspector.getByRole('textbox', { name: 'Clip name' })).toHaveValue(clipName)
		await timeline.getByRole('button', { name: new RegExp(clipName, 'i') }).first().click({ position: { x: 20, y: 20 } })
		await expect(inspector.getByRole('textbox', { name: 'Clip name' })).toHaveValue(clipName)
		await expect(inspector.getByText('1 effects')).toBeVisible()
		await setTimelineCursor(page, 0.5)
		await expect(page.getByRole('region', { name: 'Preview panel' })).toContainText('Text')
	} finally {
		await context.close()
	}
})
