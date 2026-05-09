import { expect, test } from '@playwright/test'
import path from 'node:path'

const prepareEditor = async (page: import('@playwright/test').Page) => {
	await page.goto('/')
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	const mediaRow = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' }).first()
	const timelineClip = page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video.webm/i }).first()
	await expect.poll(async () => {
		const mediaRowCount = await mediaRow.count()
		const timelineClipCount = await timelineClip.count()
		return mediaRowCount + timelineClipCount
	}, { timeout: 20_000 }).toBeGreaterThan(0)
	if (await timelineClip.count() === 0) {
		await expect(mediaRow).toBeVisible({ timeout: 20_000 })
		await mediaRow.getByRole('button', { name: 'Add to timeline' }).click()
	}
	await timelineClip.click({ timeout: 20_000 })
}

for (const viewport of [
	{ name: 'wide', width: 1440, height: 900 },
	{ name: 'narrow', width: 390, height: 844 },
] as const) {
	test(`matches Paper light editor layout on ${viewport.name} screens`, async ({ page }) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height })
		await prepareEditor(page)

		await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
		await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
		await expect(page.getByLabel('Transform controls')).toBeVisible()
		await expect(page.getByLabel('Effects editor')).toBeVisible()

		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth,
		)
		expect(hasHorizontalOverflow).toBe(false)
	})
}
