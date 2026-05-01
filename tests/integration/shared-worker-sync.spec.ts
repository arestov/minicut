import { expect, test } from '@playwright/test'

test('shared worker synchronizes project patches across browser pages', async ({ context }) => {
	const firstPage = await context.newPage()
	const secondPage = await context.newPage()

	await Promise.all([firstPage.goto('/'), secondPage.goto('/')])
	await expect(firstPage.getByRole('heading', { name: 'Video Editor Harness' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'Video Editor Harness' })).toBeVisible()

	await firstPage.getByRole('button', { name: 'New project' }).click()
	await expect(secondPage.getByRole('button', { name: /Project 1/i })).toBeVisible()

	await firstPage.getByRole('button', { name: 'Import sample' }).click()
	await expect(
		secondPage.getByLabel('Media bin').locator('strong').filter({ hasText: 'Sample asset 1' }),
	).toBeVisible()

	await firstPage.getByRole('button', { name: 'Add first resource' }).click()
	await expect(secondPage.getByRole('button', { name: /Sample asset 1 · 0.0s/i })).toBeVisible()

	await firstPage.close()
	await secondPage.close()
})