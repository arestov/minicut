import { chromium } from 'playwright'

const previewBaseUrl = process.env.MINICUT_PLAYWRIGHT_URL || 'http://127.0.0.1:4174'

const pick = (items, names) =>
	Object.fromEntries(
		names.map((name) => [name, items.find((item) => item.name === name)?.value ?? null]),
	)

const main = async () => {
	const browser = await chromium.launch({ headless: true })
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

	try {
		await page.goto(previewBaseUrl, { waitUntil: 'domcontentloaded' })
		await page.waitForFunction(() => (window).__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true, undefined, { timeout: 30_000 })

		const debug = await page.evaluate(async () => {
			const runtime = (window).__MINICUT_P2P_DEBUG__
			if (runtime?.getProjectCount?.() === 0 && typeof runtime.dispatchCreateProject === 'function') {
				await runtime.dispatchCreateProject('CSS Inspect REPL')
				await new Promise((resolve) => setTimeout(resolve, 50))
			}
			return runtime?.activeProject ?? null
		})

		void debug

		const cdp = await page.context().newCDPSession(page)
		await cdp.send('DOM.enable')
		await cdp.send('CSS.enable')

		const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
		const targets = [
			['main', ['display', 'position', 'width', 'height']],
			['[role="region"][aria-label="Timeline"]', ['display', 'position', 'width', 'height', 'overflow']],
			['[aria-label="Media bin"]', ['display', 'position', 'width', 'height', 'overflow']],
			['[aria-label="Inspector"]', ['display', 'position', 'width', 'height', 'overflow']],
			['.ve-timeline-track', ['display', 'position', 'width', 'height']],
			['.ve-timeline-clip', ['display', 'position', 'left', 'top', 'width', 'height', 'z-index', 'pointer-events']],
		]

		for (const [selector, names] of targets) {
			const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })

			if (!nodeId) {
				console.log(JSON.stringify({ selector, found: false }, null, 2))
				continue
			}

			const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId })
			console.log(JSON.stringify({ selector, found: true, computed: pick(computedStyle, names) }, null, 2))
		}
	} finally {
		await browser.close()
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})