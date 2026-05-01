import { expect, test } from '@playwright/test'

test('user can finish the harness happy path in the browser', async ({ page }) => {
	await page.goto('/')

	await expect(page.getByRole('heading', { name: 'Video Editor Harness' })).toBeVisible()

	await page.getByRole('button', { name: 'New project' }).click()
	await expect(page.getByRole('button', { name: /Project 1/i })).toBeVisible()

	await page.getByRole('button', { name: 'Import sample' }).click()
	await expect(
		page.getByLabel('Media bin').locator('strong').filter({ hasText: 'Sample asset 1' }),
	).toBeVisible()

	await page.getByRole('button', { name: 'Add first resource' }).click()
	const clip = page.getByRole('button', { name: /Sample asset 1/i }).first()
	await expect(clip).toBeVisible()

	await clip.click()
	const inspector = page.getByLabel('Inspector')
	const opacitySlider = inspector.getByLabel('Opacity')
	await opacitySlider.focus()
	for (const value of ['90', '80', '70', '60']) {
		await opacitySlider.press('ArrowLeft')
		await expect(opacitySlider).toHaveValue(value)
	}
	await expect(inspector.getByText('60%')).toBeVisible()

	await inspector.getByRole('button', { name: 'Split clip' }).click()
	await expect(page.getByRole('button', { name: /Sample asset 1/i })).toHaveCount(2)

	await inspector.getByRole('button', { name: 'Nudge +0.5s' }).click()
	await expect(inspector.getByText('3.0s')).toBeVisible()
})