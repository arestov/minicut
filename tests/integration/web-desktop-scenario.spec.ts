import { expect, test, type Download, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureFixtures } from '../../src/video-editor/media/node/testing/mediaFixtures'
import { resetParityDirectory, writeManifest } from '../parity/artifacts'
import {
	PARITY_FILES,
	PARITY_STEPS,
	clipNodeIdFromDump,
	containedRect,
	isSnapshotComplete,
	resourceNodeIdFromDump,
	snapshotFromGraphDump,
	type ParityFrameArtifact,
	type ParityManifest,
	type ParitySnapshot,
} from '../parity/sharedScenario'

/**
 * Web half of the web/desktop parity suite: the shared scenario in the real web
 * app. Files are imported through the file input, edits are model actions through
 * the page debug bridge, the preview is read from the rendered stage, the export
 * is the toolbar button. Artifacts go to tmp/parity/web; the comparison with the
 * desktop run is tests/parity/webDesktopParity.compare.test.ts.
 */

// A tall viewport and 2x pixels give the stage a readable picture for SSIM.
test.use({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 })

type Debug = {
	dumpGraph(): unknown
	dispatchRootAction(action: string, payload?: unknown): Promise<void>
	dispatchClipActionById(clipId: string, action: string, payload?: unknown): Promise<unknown>
}

const debugCall = <T,>(page: Page, name: keyof Debug, args: unknown[] = []): Promise<T> =>
	page.evaluate(
		([method, params]) => (window as unknown as { __MINICUT_P2P_DEBUG__: Record<string, (...a: unknown[]) => unknown> }).__MINICUT_P2P_DEBUG__[method as string](...(params as unknown[])) as T,
		[name, args] as const,
	)

const readDump = (page: Page) => debugCall<unknown>(page, 'dumpGraph')

const readSnapshot = async (page: Page): Promise<ParitySnapshot> => snapshotFromGraphDump(await readDump(page))

/** Polls the page graph until the snapshot satisfies `accept` (the page gets updates asynchronously). */
const waitForSnapshot = async (page: Page, what: string, accept: (snapshot: ParitySnapshot) => boolean): Promise<ParitySnapshot> => {
	let last: ParitySnapshot | null = null
	await expect
		.poll(
			async () => {
				last = await readSnapshot(page)
				return isSnapshotComplete(last) && accept(last)
			},
			{ message: `${what}: the page graph did not reach the expected state`, timeout: 45_000 },
		)
		.toBe(true)
	return last as unknown as ParitySnapshot
}

const createProjectFromMenu = async (page: Page): Promise<void> => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible({ timeout: 20_000 })
}

const saveDownload = async (download: Download, file: string): Promise<void> => {
	const failure = await download.failure()
	if (failure) throw new Error(`Download failed: ${failure}`)
	await download.saveAs(file)
}

/** Clicks the toolbar export button; returns an error text when the export does not produce a file. */
const exportFromWeb = async (page: Page, file: string): Promise<string | null> => {
	const exportButton = page.getByRole('button', { name: 'Export project' })
	await expect(exportButton).toBeEnabled({ timeout: 120_000 })
	const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
	await exportButton.click()
	try {
		await saveDownload(await downloadPromise, file)
		return null
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

/**
 * Waits until the stage shows the picture at `time`: every media layer the
 * timeline puts there is decoded at its source position and painted.
 */
const waitForStagePicture = async (page: Page, expectedLayers: number, expectedSourceTimes: number[]): Promise<void> => {
	await expect
		.poll(
			() =>
				page.evaluate(
					([layers, times]) => {
						const stage = document.querySelector('.ve-renderer__safe-area')
						if (!stage) return false
						const videos = [...stage.querySelectorAll<HTMLVideoElement>('.ve-renderer__layer video')]
						const images = [...stage.querySelectorAll<HTMLImageElement>('.ve-renderer__layer img')]
						if (videos.length + images.length !== layers) return false
						if (!images.every((image) => image.complete && image.naturalWidth > 0)) return false
						const ready = videos.every((video) => !video.seeking && video.readyState >= 2)
						const positions = videos.map((video) => video.currentTime).sort((a, b) => a - b)
						const wanted = [...(times as number[])].sort((a, b) => a - b)
						return ready && positions.length === wanted.length && positions.every((position, index) => Math.abs(position - wanted[index]) < 0.05)
					},
					[expectedLayers, expectedSourceTimes] as const,
				),
			{ message: `stage picture at ${expectedSourceTimes.join(',')}`, timeout: 30_000 },
		)
		.toBe(true)
	// Two display frames so the decoded frame is composited before the screenshot.
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test.describe('web/desktop parity: web side', () => {
	test.describe.configure({ timeout: 360_000, mode: 'serial' })

	test('runs the shared scenario in the web app', async ({ page }) => {
		const startedAt = Date.now()
		const artifacts = resetParityDirectory('web')
		const fixtures = await ensureFixtures(PARITY_FILES.map((file) => file.fixture))
		await page.goto('/')
		await createProjectFromMenu(page)

		const checkpoints: Record<string, ParitySnapshot> = {}
		const frames: ParityFrameArtifact[] = []
		const exports: ParityManifest['exports'] = []
		let current: ParitySnapshot | null = null

		const afterAction = async (what: string, run: () => Promise<unknown>): Promise<ParitySnapshot> => {
			const before = JSON.stringify(await readSnapshot(page))
			await run()
			return waitForSnapshot(page, what, (snapshot) => JSON.stringify(snapshot) !== before)
		}

		for (const step of PARITY_STEPS) {
			switch (step.op) {
				case 'import': {
					const picked = step.files.map((name) => PARITY_FILES.find((file) => file.name === name)!)
					await page.getByLabel('Import media files').setInputFiles(
						await Promise.all(
							picked.map(async (file) => ({ name: file.name, mimeType: file.mime, buffer: await readFile(fixtures[file.fixture]) })),
						),
					)
					current = await waitForSnapshot(
						page,
						'import',
						(snapshot) =>
							snapshot.resources.length === step.files.length &&
							snapshot.tracks.length === 2 &&
							snapshot.tracks.every((track) => track.clips.length > 0),
					)
					break
				}
				case 'addToTimeline': {
					const resourceId = resourceNodeIdFromDump(await readDump(page), step.resource)
					if (!resourceId) throw new Error(`No resource ${step.resource}`)
					current = await afterAction(`add ${step.resource}`, () => debugCall(page, 'dispatchRootAction', ['addActiveProjectResourceToTimeline', resourceId]))
					break
				}
				case 'clip': {
					const clipId = clipNodeIdFromDump(await readDump(page), step.clip)
					if (!clipId) throw new Error(`No clip ${JSON.stringify(step.clip)}`)
					current = await afterAction(`${step.action} ${step.clip.name}`, () => debugCall(page, 'dispatchClipActionById', [clipId, step.action, step.payload]))
					break
				}
				case 'select': {
					const clipId = clipNodeIdFromDump(await readDump(page), step.clip)
					if (!clipId) throw new Error(`No clip ${JSON.stringify(step.clip)}`)
					current = await afterAction('select', () => debugCall(page, 'dispatchRootAction', ['selectEntity', clipId]))
					break
				}
				case 'root': {
					current = await afterAction(step.action, () => debugCall(page, 'dispatchRootAction', [step.action, step.payload]))
					break
				}
				case 'checkpoint': {
					if (!current) throw new Error('checkpoint before any state')
					checkpoints[step.name] = current
					break
				}
				case 'frame': {
					current = await afterAction(`cursor ${step.time}`, () => debugCall(page, 'dispatchRootAction', ['setCursor', step.time]))
					// The layers the timeline puts at this time, and where each source must be.
					const covering = current.tracks.flatMap((track) =>
						track.clips.filter(
							(clip) =>
								(clip.mediaKind === 'video' || clip.mediaKind === 'image') &&
								step.time >= clip.start &&
								step.time < clip.start + clip.duration,
						),
					)
					const sourceTimes = covering.filter((clip) => clip.mediaKind === 'video').map((clip) => clip.in + step.time - clip.start)
					await waitForStagePicture(page, covering.length, sourceTimes)
					// With nothing under the cursor the web stage shows a text instead of a picture.
					const placeholder = covering.length === 0
					if (placeholder) await expect(page.getByText('No frame at cursor')).toBeVisible()
					const stage = await page.locator('.ve-renderer__safe-area').boundingBox()
					if (!stage) throw new Error('The preview stage has no box')
					const rect = containedRect(stage.width, stage.height)
					const file = `frame-${step.name}.png`
					await writeFile(
						join(artifacts, file),
						await page.screenshot({ clip: { x: stage.x + rect.x, y: stage.y + rect.y, width: rect.width, height: rect.height } }),
					)
					// The PNG holds only the picture box, so there is nothing to crop.
					frames.push({ name: step.name, time: step.time, file, error: null, placeholder, content: null })
					break
				}
				case 'export': {
					const file = `export-${step.name}.webm`
					const error = await exportFromWeb(page, join(artifacts, file))
					exports.push({ name: step.name, file: error ? null : file, error })
					break
				}
			}
		}

		const manifest: ParityManifest = { platform: 'web', checkpoints, frames, exports, elapsedMs: Date.now() - startedAt }
		writeManifest(manifest)
		expect(Object.keys(checkpoints).length).toBeGreaterThan(0)
	})
})
