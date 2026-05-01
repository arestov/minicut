import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const timelineTimeOriginPx = 167

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

const importFixtureVideo = async (page: import('@playwright/test').Page) => {
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
}

const setTimelineCursor = async (
	page: import('@playwright/test').Page,
	seconds: number,
): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline' })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const scrollArea = timeline.locator('.ve-timeline-scroll-area')
	await scrollArea.click({
		position: { x: timelineTimeOriginPx + seconds * zoom, y: 10 },
	})
}

test('user can finish the harness happy path in the browser', async ({ page }) => {
	await page.goto('/')

	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(page.getByLabel('Projects').getByRole('button', { name: /Project \d+/i })).toBeVisible()

	await createProjectFromMenu(page)
	await expect(page.getByRole('button', { name: /Project \d+/i })).toBeVisible()

	await importFixtureVideo(page)
	await expect(
		page.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' }),
	).toBeVisible()

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
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
	await setTimelineCursor(page, 0.5)

	await inspector.getByRole('button', { name: 'Split clip' }).click()
	await expect(page.getByRole('button', { name: /fixture-video.webm/i })).toHaveCount(2)

	await inspector.getByRole('button', { name: 'Nudge +0.5s' }).click()
	await expect(inspector.locator('dd').filter({ hasText: '1.0s' })).toBeVisible()
})

test('split clip follows playhead and reflects resulting durations in timeline widths', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	await setTimelineCursor(page, 0.5)

	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('button', { name: 'Split clip' }).click()

	const clips = timeline.getByRole('button', { name: /fixture-video.webm/i })
	await expect(clips).toHaveCount(2)
	const leftWidth = await clips.nth(0).evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
	const rightWidth = await clips.nth(1).evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
	expect(leftWidth).toBeGreaterThan(34)
	expect(leftWidth).toBeLessThan(42)
	expect(rightWidth).toBeGreaterThan(34)
	expect(rightWidth).toBeLessThan(42)
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

test('importing into an empty timeline auto-adds the first resource', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)

	await expect(page.getByRole('button', { name: 'Add first resource' })).toHaveCount(0)

	await importFixtureVideo(page)

	await expect(page.getByRole('button', { name: /fixture-video.webm/i }).first()).toBeVisible()
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

	const timeline = page.getByRole('region', { name: 'Timeline' })
	for (const resourceName of ['fixture-video.webm', 'fixture-image.png', 'fixture-audio.wav']) {
		if (await timeline.getByRole('button', { name: new RegExp(resourceName, 'i') }).count() === 0) {
			await mediaBin.locator('.ve-resource-row').filter({ hasText: resourceName }).getByRole('button', { name: 'Add to timeline' }).click()
		}
	}

	await expect(timeline.getByRole('button', { name: /fixture-video.webm/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /fixture-image.png/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /fixture-audio.wav/i })).toBeVisible()

	await timeline.getByRole('button', { name: /fixture-image.png/i }).click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByLabel('Opacity').fill('60')
	await inspector.getByLabel('X').fill('24')
	await expect(inspector.getByText('60%')).toBeVisible()

	await setTimelineCursor(page, 0.5)
	const renderer = page.getByLabel('Renderer stage')
	await expect(renderer.getByLabel('Offscreen preview canvas')).toHaveAttribute('data-render-mode', 'offscreen')
	await expect(renderer.locator('video')).toHaveCount(1)
	await expect.poll(async () =>
		renderer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
	).toBeGreaterThan(0.4)

	const imageClipText = await timeline.getByRole('button', { name: /fixture-image.png/i }).innerText()
	const imageClipStart = Number(imageClipText.match(/· (\d+(?:\.\d+)?)s \//)?.[1] ?? 0)
	await setTimelineCursor(page, imageClipStart + 0.5)
	await expect(renderer.locator('img[alt="fixture-image.png"]')).toBeVisible()
	await expect(renderer.locator('.ve-renderer__layer--image')).toHaveCSS('opacity', '0.6')

	await setTimelineCursor(page, 0.5)
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
	await setTimelineCursor(page, 8)
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
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })

	await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
	await expect(inspector.locator('dd').filter({ hasText: '0.5s' })).toHaveCount(2)
	await setTimelineCursor(page, 0.5)

	await inspector.getByRole('button', { name: 'Tint' }).click()
	await expect(inspector.getByText('1 effects')).toBeVisible()
	await expect(page.getByLabel('Renderer stage').locator('.ve-renderer__layer')).toHaveCSS('filter', /sepia/)
	await inspector.getByRole('button', { name: 'Manage effects' }).click()
	await inspector.getByRole('button', { name: 'Remove effect Tint' }).click()
	await expect(inspector.getByText('0 effects')).toBeVisible()

	await inspector.getByRole('tab', { name: 'Color' }).click()
	await inspector.getByRole('button', { name: 'Set color #16a34a' }).click()
	await expect(inspector.locator('.ve-inspector-thumb')).toHaveCSS('background-color', 'rgb(22, 163, 74)')
	await expect(clip).toHaveCSS('border-left-color', 'rgb(22, 163, 74)')
	await expect(page.getByLabel('Renderer stage').locator('.ve-renderer__layer')).toHaveCSS('border-color', 'rgb(22, 163, 74)')

	await inspector.getByRole('tab', { name: 'Audio' }).click()
	await expect(inspector.getByLabel('Audio inspector').getByText('Gain')).toBeVisible()
	await expect(inspector.getByLabel('Audio inspector').getByText('Pan')).toBeVisible()

	await inspector.getByRole('tab', { name: 'Export' }).click()
	const exportButton = inspector.getByRole('button', { name: 'Queue clip export' })
	await expect(exportButton).toBeVisible()
	await exportButton.click()
	await expect(inspector.getByRole('status')).toHaveText(/Export ready: \d+ frames/)

	await inspector.getByRole('tab', { name: 'Edit' }).click()
	const overflowingInspectorButtons = await inspector.locator('.ve-button-grid button, .ve-inline-actions button').evaluateAll((buttons) =>
		buttons
			.filter((button) => button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight)
			.map((button) => button.textContent?.trim() ?? ''),
	)
	expect(overflowingInspectorButtons).toEqual([])
	await inspector.getByRole('button', { name: 'Delete clip' }).click()
	await expect(page.getByText('Select a clip to edit opacity or split it.')).toBeVisible()
})

test('timeline zoom controls and inspector trim boundary states behave correctly', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	await expect(timeline.getByText('56 px/s')).toBeVisible()
	const zoomIn = timeline.getByRole('button', { name: 'Zoom in' })
	const zoomOut = timeline.getByRole('button', { name: 'Zoom out' })
	await zoomIn.click()
	await expect(timeline.getByText('64 px/s')).toBeVisible()
	await zoomOut.click()
	await expect(timeline.getByText('56 px/s')).toBeVisible()

	for (let index = 0; index < 20; index += 1) {
		if (await zoomIn.isDisabled()) {
			break
		}
		await zoomIn.click()
	}
	await expect(timeline.getByText('96 px/s')).toBeVisible()
	await expect(zoomIn).toBeDisabled()

	for (let index = 0; index < 30; index += 1) {
		if (await zoomOut.isDisabled()) {
			break
		}
		await zoomOut.click()
	}
	await expect(timeline.getByText('8 px/s')).toBeVisible()
	await expect(zoomOut).toBeDisabled()

	for (let index = 0; index < 6; index += 1) {
		await zoomIn.click()
	}
	await expect(timeline.getByText('56 px/s')).toBeVisible()

	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await expect(inspector.getByRole('button', { name: 'Start -0.5s' })).toBeDisabled()
	await inspector.getByRole('button', { name: 'End +0.5s' }).click()
	await expect(inspector.locator('dd').filter({ hasText: '1.5s' })).toBeVisible()
})

test('media resources render metadata and action on separate lines', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const mediaBin = page.getByLabel('Media bin')
	const firstResource = mediaBin.locator('.ve-resource-row').first()
	const layout = await firstResource.evaluate((row) => {
		const small = row.querySelector('small')
		const button = row.querySelector('button')
		if (!small || !button) {
			return { smallTop: 0, buttonTop: 0 }
		}

		const smallRect = small.getBoundingClientRect()
		const buttonRect = button.getBoundingClientRect()
		return {
			smallTop: smallRect.top,
			buttonTop: buttonRect.top,
		}
	})

	expect(layout.buttonTop).toBeGreaterThan(layout.smallTop)
})

test('dragging a clip changes its timeline start position', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await expect(clip).toHaveText(/0\.0s \/ 1\.0s/)

	const box = await clip.boundingBox()
	if (!box) {
		throw new Error('Clip bounding box is unavailable for drag simulation')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).not.toHaveText(/0\.0s \/ 1\.0s/)
})

test('resizing a clip from the right edge changes its duration', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await expect(clip).toHaveText(/0\.0s \/ 1\.0s/)
	const handle = clip.locator('.ve-clip__resize-handle--end')
	const box = await handle.boundingBox()
	if (!box) {
		throw new Error('Clip end resize handle bounding box is unavailable')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.0s \/ 1\.5s/)
})

test('resizing a clip from the left edge trims its start and duration', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	const handle = clip.locator('.ve-clip__resize-handle--start')
	const box = await handle.boundingBox()
	if (!box) {
		throw new Error('Clip start resize handle bounding box is unavailable')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.5s \/ 0\.5s/)
})

test('dragging a clip before the timeline start clamps to zero', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	const box = await clip.boundingBox()
	if (!box) {
		throw new Error('Clip bounding box is unavailable for drag simulation')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 - 320, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.0s \/ 1\.0s/)
})

test('playback toggle advances timeline cursor over time', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

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

test('timeline tools perform select, split, trim, and hand pan actions', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await timeline.getByRole('button', { name: 'Select tool' }).click()
	await clip.click()
	await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('fixture-video.webm')

	const trimTool = timeline.getByRole('button', { name: 'Trim tool' })
	const splitTool = timeline.getByRole('button', { name: 'Split tool' })
	await expect(trimTool).toHaveAttribute('data-icon-name', 'stretch-horizontal')
	await expect(splitTool).toHaveAttribute('data-icon-name', 'scissors')
	await splitTool.click()
	await clip.click({ position: { x: 28, y: 20 } })
	await expect(timeline.getByRole('button', { name: /fixture-video.webm/i })).toHaveCount(2)

	const rightClip = timeline.getByRole('button', { name: /fixture-video.webm/i }).nth(1)
	await trimTool.click()
	await expect(rightClip).toHaveAttribute('data-tool', 'trim')
	const beforeTrimText = await rightClip.innerText()
	const handle = rightClip.locator('.ve-clip__resize-handle--end')
	const handleBox = await handle.boundingBox()
	if (!handleBox) {
		throw new Error('Trim handle is unavailable')
	}
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(handleBox.x + handleBox.width / 2 + 28, handleBox.y + handleBox.height / 2)
	await page.mouse.up()
	await expect(rightClip).not.toHaveText(beforeTrimText)

	for (let index = 0; index < 8; index += 1) {
		await timeline.getByRole('button', { name: 'Add video track' }).click()
	}
	const videoResource = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	for (let index = 0; index < 24; index += 1) {
		await videoResource.getByRole('button', { name: 'Add to timeline' }).click()
	}
	await timeline.getByRole('button', { name: 'Hand tool' }).click()
	const scrollArea = timeline.locator('.ve-timeline-scroll-area')
	const firstRail = timeline.locator('.ve-track-row__rail').first()
	await expect.poll(async () => firstRail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
	await firstRail.evaluate((element) => { element.scrollLeft = 0 })
	const scrollBox = await scrollArea.boundingBox()
	if (!scrollBox) {
		throw new Error('Timeline scroll area is unavailable')
	}
	await page.mouse.move(scrollBox.x + scrollBox.width - 30, scrollBox.y + scrollBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(scrollBox.x + 20, scrollBox.y + scrollBox.height / 2)
	await page.mouse.up()
	await expect.poll(async () => firstRail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
})

test('timeline clip boxes align to the ruler and playhead origin', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	const rulerBox = await timeline.getByLabel('Time ruler').boundingBox()
	const playheadBox = await timeline.getByLabel('Current step').boundingBox()
	const clipBox = await clip.boundingBox()
	if (!rulerBox || !playheadBox || !clipBox) {
		throw new Error('Timeline geometry boxes are unavailable')
	}

	expect(Math.abs(clipBox.x - rulerBox.x)).toBeLessThanOrEqual(2)
	expect(Math.abs(playheadBox.x - rulerBox.x)).toBeLessThanOrEqual(2)
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	expect(Math.abs(clipBox.width - zoom)).toBeLessThanOrEqual(2)
})

test('preview keeps offscreen canvas active and syncs media layers across playhead positions', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureMedia(page)

	const mediaBin = page.getByLabel('Media bin')
	const timeline = page.getByRole('region', { name: 'Timeline' })
	for (const resourceName of ['fixture-image.png', 'fixture-audio.wav']) {
		if (await timeline.getByRole('button', { name: new RegExp(resourceName, 'i') }).count() === 0) {
			await mediaBin.locator('.ve-resource-row').filter({ hasText: resourceName }).getByRole('button', { name: 'Add to timeline' }).click()
		}
	}

	const renderer = page.getByLabel('Renderer stage')
	const canvas = renderer.getByLabel('Offscreen preview canvas')
	await setTimelineCursor(page, 0.5)
	await expect(canvas).toHaveAttribute('data-render-mode', 'offscreen')
	await expect(renderer.locator('video')).toHaveCount(1)
	await expect(renderer.locator('audio')).toHaveCount(1)
	await expect.poll(async () =>
		renderer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
	).toBeGreaterThan(0.4)
	await setTimelineCursor(page, 0.75)
	await expect.poll(async () =>
		renderer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
	).toBeGreaterThan(0.7)
	const safeAreaBox = await renderer.locator('.ve-renderer__safe-area').boundingBox()
	const videoLayerBox = await renderer.locator('.ve-renderer__layer--video').boundingBox()
	if (!safeAreaBox || !videoLayerBox) {
		throw new Error('Preview geometry boxes are unavailable')
	}
	expect(Math.abs(videoLayerBox.width - safeAreaBox.width)).toBeLessThanOrEqual(2)
	expect(Math.abs(videoLayerBox.height - safeAreaBox.height)).toBeLessThanOrEqual(2)

	const imageClipText = await timeline.getByRole('button', { name: /fixture-image.png/i }).first().innerText()
	const imageClipStart = Number(imageClipText.match(/· (\d+(?:\.\d+)?)s \//)?.[1] ?? 0)
	await setTimelineCursor(page, imageClipStart + 0.5)
	await expect(renderer.locator('img[alt="fixture-image.png"]')).toBeVisible()
	await expect(renderer.locator('video')).toHaveCount(0)

	await setTimelineCursor(page, imageClipStart + 2)
	await expect(renderer.getByText('No frame at cursor')).toBeVisible()
})

test('preview sends playhead renders through an OffscreenCanvas worker', async ({ page }) => {
	await page.addInitScript(() => {
		const messages: unknown[] = []
		Object.defineProperty(window, '__previewWorkerMessages', { value: messages, configurable: true })
		Object.defineProperty(window, '__previewOffscreenTransfers', { value: 0, writable: true, configurable: true })

		class PreviewWorkerProbe {
			url: unknown
			options: unknown

			constructor(url: unknown, options: unknown) {
				this.url = url
				this.options = options
			}

			postMessage(message: unknown) {
				messages.push(message)
			}

			terminate() {}
			addEventListener() {}
			removeEventListener() {}
			dispatchEvent() { return true }
		}

		Object.defineProperty(window, 'Worker', { value: PreviewWorkerProbe, configurable: true })
		Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
			value() {
				window.__previewOffscreenTransfers += 1
				return { __offscreenCanvasProbe: true }
			},
			configurable: true,
		})
	})

	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const renderer = page.getByLabel('Renderer stage')
	await setTimelineCursor(page, 0.25)
	await expect(renderer.getByLabel('Offscreen preview canvas')).toHaveAttribute('data-render-mode', 'offscreen')
	await setTimelineCursor(page, 0.75)

	const probe = await page.evaluate(() => ({
		transfers: window.__previewOffscreenTransfers,
		messages: window.__previewWorkerMessages,
	}))
	expect(probe.transfers).toBe(1)
	expect(probe.messages).toEqual(expect.arrayContaining([
		expect.objectContaining({ type: 'init' }),
		expect.objectContaining({
			type: 'render',
			cursor: expect.closeTo(0.75, 1),
			clips: expect.arrayContaining([
				expect.objectContaining({ name: 'fixture-video.webm', kind: 'video' }),
			]),
		}),
	]))
})

test('export project button downloads a webm video file', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	expect(download.suggestedFilename()).toMatch(/\.webm$/)
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	const videoFile = await fs.stat(downloadPath as string)
	expect(videoFile.size).toBeGreaterThan(0)
	await expect(page.getByRole('status').filter({ hasText: 'Export ready' })).toBeVisible()
})