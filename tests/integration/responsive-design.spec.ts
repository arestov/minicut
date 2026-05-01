import { expect, test } from '@playwright/test'
import path from 'node:path'

const prepareEditor = async (page: import('@playwright/test').Page) => {
	await page.goto('/')
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	await page.getByRole('button', { name: /fixture-video.webm/i }).first().click()
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
