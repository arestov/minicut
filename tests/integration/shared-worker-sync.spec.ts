import { expect, test } from '@playwright/test'
import path from 'node:path'

/**
 * Create a project with a unique title via the debug bridge so selection
 * is unambiguous even when auto-seeding has already created "Project 1"
 * on both pages concurrently.
 */
const createProjectViaDebugBridge = async (
	page: import('@playwright/test').Page,
	title: string,
): Promise<void> => {
	await page.evaluate(async (nextTitle) => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				dispatchCreateProject: (title?: string) => Promise<unknown>
			}
		}).__MINICUT_P2P_DEBUG__
		if (!debug) throw new Error('P2P debug bridge is unavailable')
		await debug.dispatchCreateProject(nextTitle)
	}, title)
}

test('shared worker synchronizes project patches across browser pages', async ({ context }) => {
	const firstPage = await context.newPage()
	const secondPage = await context.newPage()

	await Promise.all([firstPage.goto('/'), secondPage.goto('/')])
	await expect(firstPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'minicut' })).toBeVisible()

	// Create a project with a unique title so the selector is unambiguous even
	// when auto-seeding has already added "Project 1" on both pages.
	const uniqueTitle = `SyncTest-${Date.now()}`
	await createProjectViaDebugBridge(firstPage, uniqueTitle)
	await expect(firstPage.getByLabel('Projects').getByRole('button', { name: uniqueTitle })).toBeVisible()

	// secondPage should receive the project via SharedWorker; open its dropdown
	// and switch to the unique project.
	const secondProjectsRegion = secondPage.getByLabel('Projects')
	await secondProjectsRegion.getByRole('button').click()
	await expect(secondProjectsRegion.getByRole('menuitem', { name: uniqueTitle })).toBeVisible({ timeout: 10_000 })
	await secondProjectsRegion.getByRole('menuitem', { name: uniqueTitle }).click()

	await firstPage.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	await expect(
		secondPage.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' }),
	).toBeVisible()

	await expect(
		secondPage
			.getByRole('region', { name: 'Timeline' })
			.getByRole('button', { name: /fixture-video\.webm.*0\.0+s\s*\/\s*1\.0+s/i })
			.first(),
	).toBeVisible()

	await firstPage.close()
	await secondPage.close()
})