import { chromium } from 'playwright'

const previewBaseUrl = process.env.MINICUT_PLAYWRIGHT_URL || 'http://127.0.0.1:4174'

const main = async () => {
	const browser = await chromium.launch({ headless: true })
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

	try {
		await page.goto(previewBaseUrl, { waitUntil: 'domcontentloaded' })
		await page.waitForFunction(() => (window).__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true, undefined, { timeout: 30_000 })

		const payload = await page.evaluate(async () => {
			const debug = (window).__MINICUT_P2P_DEBUG__
			if (!debug) {
				throw new Error('debug runtime is not available')
			}

			if (debug.getProjectCount?.() === 0 && typeof debug.dispatchCreateProject === 'function') {
				await debug.dispatchCreateProject('Runtime Inspect REPL')
				await new Promise((resolve) => setTimeout(resolve, 50))
			}

			return {
				snapshot: debug.getSnapshot?.() ?? null,
				activeProject: debug.getActiveProjectDetails?.() ?? null,
				selection: debug.getSelectionState?.() ?? null,
				graph: debug.dumpGraph?.() ?? null,
				messages: debug.getRuntimeMessages?.() ?? [],
			}
		})

		console.log(JSON.stringify(payload, null, 2))
	} finally {
		await browser.close()
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})