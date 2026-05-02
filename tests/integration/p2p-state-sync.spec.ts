import { expect, test } from '@playwright/test'
const createProjectFromMenu = async (page: import('@playwright/test').Page) => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').first().click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

test('p2p state sync works across tabs in one room', async ({ context }) => {
	const roomId = `p2p-sync-${Date.now().toString(36)}`
	const roomUrl = `/#/${roomId}`
	const firstPage = await context.newPage()
	const secondPage = await context.newPage()

	await Promise.all([firstPage.goto(roomUrl), secondPage.goto(roomUrl)])
	await expect(firstPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'minicut' })).toBeVisible()

	const firstProjectsRegion = firstPage.getByLabel('Projects')
	await firstProjectsRegion.getByRole('button').first().click()
	const firstBeforeCount = await firstProjectsRegion.getByRole('button', { name: /Project \d+/i }).count()
	await firstProjectsRegion.getByRole('button').first().click()

	const secondProjectsRegion = secondPage.getByLabel('Projects')
	await secondProjectsRegion.getByRole('button').first().click()
	const secondBeforeCount = await secondProjectsRegion.getByRole('button', { name: /Project \d+/i }).count()
	await secondProjectsRegion.getByRole('button').first().click()

	await createProjectFromMenu(firstPage)
	await firstProjectsRegion.getByRole('button').first().click()
	await expect(firstProjectsRegion.getByRole('button', { name: /Project \d+/i })).toHaveCount(firstBeforeCount + 1, {
		timeout: 8_000,
	})
	await firstProjectsRegion.getByRole('button').first().click()

	await secondProjectsRegion.getByRole('button').first().click()
	await expect(secondProjectsRegion.getByRole('button', { name: /Project \d+/i })).toHaveCount(secondBeforeCount + 1, {
		timeout: 12_000,
	})

	await firstPage.close()
	await secondPage.close()
})
