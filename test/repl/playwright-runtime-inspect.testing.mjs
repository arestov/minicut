/**
 * TESTING AND DEBUG ONLY — DO NOT USE IN PRODUCTION CODE
 *
 * Browser-side runtime inspector.
 * Captures page graph, worker dump and divergence summary.
 */

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

			const pageGraph = debug.dumpGraph?.() ?? null

			let workerState = null
			if (typeof debug.dumpWorkerState === 'function') {
				try {
					workerState = await debug.dumpWorkerState()
				} catch {
					workerState = null
				}
			}

			const pageNodeIds = new Set(
				Array.isArray(pageGraph?.nodes)
					? pageGraph.nodes.map((n) => n?.nodeId).filter((id) => typeof id === 'string')
					: [],
			)
			const workerNodeIds = new Set(
				Array.isArray(workerState?.lined)
					? workerState.lined.map((n) => n?.nodeId).filter((id) => typeof id === 'string')
					: [],
			)
			const onlyInPage = [...pageNodeIds].filter((id) => !workerNodeIds.has(id))
			const onlyInWorker = [...workerNodeIds].filter((id) => !pageNodeIds.has(id))

			return {
				snapshot: debug.getSnapshot?.() ?? null,
				activeProject: debug.getActiveProjectDetails?.() ?? null,
				selection: debug.getSelectionState?.() ?? null,
				graph: pageGraph,
				messages: debug.getRuntimeMessages?.() ?? [],
				workerState,
				runtimeTasks: debug.dumpRuntimeTasks?.() ?? null,
				divergence: {
					onlyInPageCount: onlyInPage.length,
					onlyInWorkerCount: onlyInWorker.length,
					onlyInPage: onlyInPage.length > 0 ? onlyInPage : undefined,
					onlyInWorker: onlyInWorker.length > 0 ? onlyInWorker : undefined,
				},
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
