import { expect, test } from '@playwright/test'
import path from 'node:path'

const createProjectFromToolbar = async (page: import('@playwright/test').Page) => {
	const beforeCount = await page.evaluate(() => {
		const debug = (window as Window & {
			__MINICUT_P2P_DEBUG__?: {
				getProjectCount?: () => number
			}
		}).__MINICUT_P2P_DEBUG__
		return debug?.getProjectCount?.() ?? 0
	})
	await page.getByRole('banner').getByRole('button', { name: 'New project' }).click()
	await expect.poll(async () => {
		return page.evaluate(() => {
			const debug = (window as Window & {
				__MINICUT_P2P_DEBUG__?: {
					getProjectCount?: () => number
				}
			}).__MINICUT_P2P_DEBUG__
			return debug?.getProjectCount?.() ?? 0
		})
	}, { timeout: 20_000 }).toBeGreaterThan(beforeCount)
}

const prepareEditor = async (page: import('@playwright/test').Page) => {
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await createProjectFromToolbar(page)
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	const mediaBin = page.getByLabel('Media bin')
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible({ timeout: 20_000 })
	const mediaRow = mediaBin.locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' }).first()
	const timelineClip = page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video.webm/i }).first()
	if (await timelineClip.count() === 0) {
		await expect(mediaRow).toBeVisible({ timeout: 20_000 })
		await mediaRow.getByRole('button', { name: 'Add to timeline' }).click()
	}
	await expect(timelineClip).toBeVisible({ timeout: 20_000 })
	await timelineClip.click()
}

for (const viewport of [
	{ name: 'wide', width: 1440, height: 900 },
	{ name: 'narrow', width: 390, height: 844 },
] as const) {
	test(`matches Paper light editor layout on ${viewport.name} screens`, async ({ page }) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height })
		await prepareEditor(page)

		await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await expect(page.getByRole('region', { name: 'Timeline', exact: true })).toBeVisible()
		await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
		await expect(page.getByLabel('Transform controls')).toBeVisible()
		await expect(page.getByLabel('Effects editor')).toBeVisible()

		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth,
		)
		expect(hasHorizontalOverflow).toBe(false)
	})
}
