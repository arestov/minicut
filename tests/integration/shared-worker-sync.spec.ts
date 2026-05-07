import { expect, test } from '@playwright/test'
import path from 'node:path'

const createProjectFromMenu = async (page: import('@playwright/test').Page) => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

test('shared worker synchronizes project patches across browser pages', async ({ context }) => {
	const firstPage = await context.newPage()
	const secondPage = await context.newPage()

	await Promise.all([firstPage.goto('/'), secondPage.goto('/')])
	await expect(firstPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'minicut' })).toBeVisible()

	await createProjectFromMenu(firstPage)
	const sourceProjectName = (await firstPage.getByLabel('Projects').getByRole('button').innerText()).trim()
	await expect(secondPage.getByRole('button', { name: /Project \d+/i })).toBeVisible()
	const secondProjectsRegion = secondPage.getByLabel('Projects')
	await secondProjectsRegion.getByRole('button').click()
	await secondProjectsRegion.getByRole('menuitem', { name: new RegExp(sourceProjectName, 'i') }).click()

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