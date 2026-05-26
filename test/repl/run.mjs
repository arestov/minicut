import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

const wait = (ms) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms)
	})

const shouldReport = process.env.MINICUT_REPL_REPORT !== '0'
const dumpGraph = process.env.MINICUT_REPL_DUMP_GRAPH === '1'
const dumpMessages = process.env.MINICUT_REPL_DUMP_MESSAGES === '1'
let isShuttingDown = false

process.on('uncaughtException', (error) => {
	const message = error instanceof Error ? error.message : String(error)
	if (isShuttingDown && message.includes('node_id_to_shape_list')) {
		console.warn('[minicut-repl] ignored teardown race:', message)
		return
	}
	throw error
})

const installDomGlobals = (window) => {
	const defineGlobal = (name, value) => {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			enumerable: true,
			value,
			writable: true,
		})
	}

	defineGlobal('window', window)
	defineGlobal('self', window)
	defineGlobal('document', window.document)
	defineGlobal('navigator', window.navigator)
	defineGlobal('location', window.location)
	defineGlobal('history', window.history)
	defineGlobal('HTMLElement', window.HTMLElement)
	defineGlobal('Element', window.Element)
	defineGlobal('Node', window.Node)
	defineGlobal('Text', window.Text)
	defineGlobal('Comment', window.Comment)
	defineGlobal('MutationObserver', window.MutationObserver)
	defineGlobal('DOMRect', window.DOMRect)
	defineGlobal('Event', window.Event)
	defineGlobal('CustomEvent', window.CustomEvent)
	defineGlobal('KeyboardEvent', window.KeyboardEvent)
	defineGlobal('MouseEvent', window.MouseEvent)
	defineGlobal('FocusEvent', window.FocusEvent)
	defineGlobal('Blob', window.Blob)
	defineGlobal('File', window.File)
	defineGlobal('getComputedStyle', window.getComputedStyle.bind(window))
	defineGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window))
	defineGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
	if (window.crypto) {
		defineGlobal('crypto', window.crypto)
	}
}

const logJsonSection = (label, value) => {
	console.log(`[minicut-repl] ${label}`, JSON.stringify(value, null, 2))
}

const runScenario = async (harness) => {
	const scenarioPath = process.env.MINICUT_REPL_SCENARIO
	if (!scenarioPath) {
		return
	}

	const resolved = path.isAbsolute(scenarioPath)
		? scenarioPath
		: path.resolve(repoRoot, scenarioPath)
	const scenarioModule = await import(pathToFileURL(resolved).href)
	const run = scenarioModule.run ?? scenarioModule.default
	if (typeof run !== 'function') {
		throw new Error(`Scenario module must export run(): ${resolved}`)
	}

	await run(harness)
}

const main = async () => {
	const dom = new JSDOM(
		'<!doctype html><html><head></head><body><div id="root"></div></body></html>',
		{
			pretendToBeVisual: true,
			url: 'http://localhost/',
		},
	)

	installDomGlobals(dom.window)

	const { createMiniCutReplHarness } = await import('./bootstrap.tsx')
	const rootElement = dom.window.document.getElementById('root')
	if (!rootElement) {
		throw new Error('missing #root element in jsdom')
	}

	const harness = await createMiniCutReplHarness({
		window: dom.window,
		rootElement,
		sessionKey: process.env.MINICUT_REPL_SESSION_KEY || 'minicut-repl',
	})

	try {
		await harness.whenReady()
		await runScenario(harness)
		await harness.flush(Number(process.env.MINICUT_REPL_POST_SCENARIO_TICKS || 2))
		await wait(Number(process.env.MINICUT_REPL_POST_READY_WAIT_MS || 0))

		if (shouldReport) {
			logJsonSection('snapshot', harness.inspect.snapshot())
			logJsonSection('root', harness.inspect.root())
			logJsonSection('active project', harness.inspect.activeProject())
			logJsonSection('graph summary', harness.inspect.graphSummary())
			logJsonSection('body', rootElement.innerHTML)

			if (dumpMessages) {
				logJsonSection('messages:full', harness.inspect.messages())
			} else {
				logJsonSection('messages', harness.inspect.messages().slice(-20))
			}

			if (dumpGraph) {
				logJsonSection('graph:full', harness.inspect.graph())
			}
		}
	} finally {
		isShuttingDown = true
		if (process.env.MINICUT_REPL_SKIP_DESTROY !== '1') {
			harness.destroy()
			await wait(0)
		}
	}
}

main().catch((error) => {
	console.error('[minicut-repl] failed')
	console.error(error)
	process.exitCode = 1
})