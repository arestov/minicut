import { expect, test } from '@playwright/test'
import path from 'node:path'

const createProjectFromMenu = async (page: import('@playwright/test').Page) => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

const importFixtureMedia = async (page: import('@playwright/test').Page) => {
	const importInput = page.getByLabel('Import media files')
	await expect(importInput).toBeEnabled()
	await importInput.setInputFiles([
		path.resolve('tests/fixtures/media/fixture-video.webm'),
		path.resolve('tests/fixtures/media/fixture-image.png'),
		path.resolve('tests/fixtures/media/fixture-audio.wav'),
	])
}

test('user can finish the harness happy path in the browser', async ({ page }) => {
	await page.goto('/')

	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(page.getByLabel('Projects').getByRole('button', { name: /Project \d+/i })).toBeVisible()

	await createProjectFromMenu(page)
	await expect(page.getByRole('button', { name: /Project \d+/i })).toBeVisible()

	await page.getByRole('button', { name: 'Import sample' }).click()
	await expect(
		page.getByLabel('Media bin').locator('strong').filter({ hasText: 'Sample asset 1' }),
	).toBeVisible()

	await page.getByRole('button', { name: 'Add first resource' }).click()
	const clip = page.getByRole('button', { name: /Sample asset 1/i }).first()
	await expect(clip).toBeVisible()

	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
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
	await expect(inspector.locator('dd').filter({ hasText: '3.0s' })).toBeVisible()
})

test('project dropdown shows items when opened', async ({ page }) => {
	await page.goto('/')

	await createProjectFromMenu(page)
	await createProjectFromMenu(page)

	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button', { name: /Project \d+/i }).click()
	const projectList = projectsRegion.getByRole('list')

	await expect(projectList.getByRole('button', { name: /Project 1/i })).toBeVisible()
	await expect(projectList.getByRole('button', { name: /Project 2/i })).toBeVisible()
})

test('imports real media files, edits timeline clips, and previews actual media elements', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)

	await importFixtureMedia(page)

	const mediaBin = page.getByLabel('Media bin')
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible()
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-image.png' })).toBeVisible()
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-audio.wav' })).toBeVisible()
	await expect(mediaBin.getByLabel('fixture-video.webm thumbnail')).toBeVisible()
	await expect(mediaBin.locator('img[alt="fixture-image.png thumbnail"]')).toBeVisible()
	await expect(mediaBin.getByLabel('audio thumbnail')).toBeVisible()

	await mediaBin.getByRole('button', { name: /Add to timeline/i }).nth(0).click()
	await mediaBin.getByRole('button', { name: /Add to timeline/i }).nth(1).click()
	await mediaBin.getByRole('button', { name: /Add to timeline/i }).nth(2).click()

	const timeline = page.getByRole('region', { name: 'Timeline' })
	await expect(timeline.getByRole('button', { name: /fixture-video.webm/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /fixture-image.png/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /fixture-audio.wav/i })).toBeVisible()

	await timeline.getByRole('button', { name: /fixture-image.png/i }).click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByLabel('Opacity').fill('60')
	await inspector.getByLabel('X').fill('24')
	await expect(inspector.getByText('60%')).toBeVisible()

	const cursor = timeline.getByRole('slider', { name: 'Cursor' })
	await cursor.fill('0.5')
	const renderer = page.getByLabel('Renderer stage')
	await expect(renderer.getByLabel('Offscreen preview canvas')).toHaveAttribute('data-render-mode', 'offscreen')
	await expect(renderer.locator('video')).toHaveCount(1)

	await cursor.fill('6.5')
	await expect(renderer.locator('img[alt="fixture-image.png"]')).toBeVisible()
	await expect(renderer.locator('.ve-renderer__layer--image')).toHaveCSS('opacity', '0.6')

	await cursor.fill('0.5')
	await expect(renderer.locator('audio')).toHaveCount(1)
})

test('timeline uses one shared current step and keeps many tracks scrollable', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	for (let index = 0; index < 10; index += 1) {
		await timeline.getByRole('button', { name: 'Add video track' }).click()
		await timeline.getByRole('button', { name: 'Add audio track' }).click()
	}

	await expect(timeline.getByText('22 tracks')).toBeVisible()
	await timeline.getByRole('slider', { name: 'Cursor' }).fill('8')
	await expect(timeline.getByLabel('Current step')).toHaveCount(1)
	await expect(timeline.getByLabel('Current time')).toHaveText('8.00s')

	const scrollMetrics = await timeline.locator('.ve-timeline-scroll-area').evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}))
	expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)

	await timeline.locator('.ve-timeline-scroll-area').evaluate((element) => {
		element.scrollTop = element.scrollHeight
	})
	await expect(timeline.getByText('A11')).toBeVisible()
})

test('inspector feature controls combine trim, color, effects, audio, export, and delete', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await page.getByRole('button', { name: 'Import sample' }).click()
	await page.getByRole('button', { name: 'Add first resource' }).click()

	const clip = page.getByRole('button', { name: /Sample asset 1/i }).first()
	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })

	await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
	await inspector.getByRole('button', { name: 'End -0.5s' }).click()
	await expect(inspector.locator('dd').filter({ hasText: '0.5s' })).toBeVisible()
	await page.getByRole('region', { name: 'Timeline' }).getByRole('slider', { name: 'Cursor' }).fill('0.5')

	await inspector.getByRole('button', { name: 'Tint' }).click()
	await expect(inspector.getByText('1 effects')).toBeVisible()
	await expect(page.getByLabel('Renderer stage').locator('.ve-renderer__layer')).toHaveCSS('filter', /sepia/)

	await inspector.getByRole('tab', { name: 'Color' }).click()
	await inspector.getByRole('button', { name: 'Set color #16a34a' }).click()
	await expect(inspector.locator('.ve-inspector-thumb')).toHaveCSS('background-color', 'rgb(22, 163, 74)')

	await inspector.getByRole('tab', { name: 'Audio' }).click()
	await expect(inspector.getByLabel('Audio inspector').getByText('Gain')).toBeVisible()
	await expect(inspector.getByLabel('Audio inspector').getByText('Pan')).toBeVisible()

	await inspector.getByRole('tab', { name: 'Export' }).click()
	await expect(inspector.getByRole('button', { name: 'Queue clip export' })).toBeVisible()

	await inspector.getByRole('tab', { name: 'Edit' }).click()
	await inspector.getByRole('button', { name: 'Delete clip' }).click()
	await expect(page.getByText('Select a clip to edit opacity or split it.')).toBeVisible()
})

test('dragging a clip changes its timeline start position', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await page.getByRole('button', { name: 'Import sample' }).click()
	await page.getByRole('button', { name: 'Add first resource' }).click()

	const clip = page.getByRole('button', { name: /Sample asset 1/i }).first()
	await expect(clip).toHaveText(/0\.0s \/ 5\.0s/)

	const box = await clip.boundingBox()
	if (!box) {
		throw new Error('Clip bounding box is unavailable for drag simulation')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).not.toHaveText(/0\.0s \/ 5\.0s/)
})

test('playback toggle advances timeline cursor over time', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await page.getByRole('button', { name: 'Import sample' }).click()
	await page.getByRole('button', { name: 'Add first resource' }).click()

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const currentTime = timeline.getByLabel('Current time')
	await expect(currentTime).toHaveText('0.00s')

	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Play' }).click()
	await page.waitForTimeout(700)
	await expect(currentTime).not.toHaveText('0.00s')
	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Pause' }).click()
})

test('creates an initial project automatically on startup', async ({ page }) => {
	await page.goto('/')
	const projectsRegion = page.getByLabel('Projects')
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
	await expect(page.getByLabel('Media bin')).not.toContainText('No active project.')
})