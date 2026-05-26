import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const previewBaseUrl = process.env.MINICUT_PLAYWRIGHT_URL || 'http://127.0.0.1:4174'
const screenshotPath = path.join(repoRoot, 'test/repl/minicut-playwright.png')

const waitForDebugRuntime = async (page) => {
	await page.waitForFunction(() => Boolean((window).__MINICUT_P2P_DEBUG__), undefined, { timeout: 30_000 })
	await page.waitForFunction(() => (window).__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true, undefined, { timeout: 30_000 })
}

const main = async () => {
	await mkdir(path.dirname(screenshotPath), { recursive: true })

	const browser = await chromium.launch({ headless: true })
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

	try {
		await page.goto(previewBaseUrl, { waitUntil: 'domcontentloaded' })
		await waitForDebugRuntime(page)

		const summary = await page.evaluate(async () => {
			const debug = (window).__MINICUT_P2P_DEBUG__
			if (!debug) {
				throw new Error('__MINICUT_P2P_DEBUG__ is not available')
			}

			if (debug.getProjectCount?.() === 0 && typeof debug.dispatchCreateProject === 'function') {
				await debug.dispatchCreateProject('Playwright REPL')
				await new Promise((resolve) => setTimeout(resolve, 50))
			}

			return {
				snapshot: debug.getSnapshot?.() ?? null,
				projectCount: debug.getProjectCount?.() ?? 0,
				projectTitles: debug.getProjectTitles?.() ?? [],
				tracks: debug.getActiveProjectTracks?.() ?? [],
				primaryTracks: debug.getActiveProjectPrimaryTracks?.() ?? null,
				selection: debug.getSelectionState?.() ?? null,
				activeProject: debug.getActiveProjectDetails?.() ?? null,
				messages: debug.getRuntimeMessages?.().slice(-20) ?? [],
				graphSummary: debug.dumpGraphSummary?.() ?? null,
			}
		})

		await page.screenshot({ path: screenshotPath, fullPage: true })

		console.log('[minicut-playwright] summary', JSON.stringify(summary, null, 2))
		console.log('[minicut-playwright] screenshot', screenshotPath)
	} finally {
		await browser.close()
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})