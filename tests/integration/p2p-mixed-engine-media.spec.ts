import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { chromium, firefox, type Browser } from 'playwright'

const APP_URL = 'http://127.0.0.1:4174'
const SIGNAL_URL = 'http://127.0.0.1:8787'

type BrowserEngine = 'firefox' | 'msedge'

type DebugTransfer = {
	resourceId: string
	name: string
	ownerPeerId: string | null
	status: 'missing' | 'requesting' | 'partial' | 'ready' | 'error'
	progress: number
	totalBytes: number
	loadedBytes: number
	previewUrl: string
	loadedRanges: Array<[number, number]>
	requestedRanges: Array<[number, number]>
	requestedRangesLog: Array<[number, number]>
	requestEvents: Array<{ reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'; ranges: Array<[number, number]> }>
	mode: 'local' | 'mirrored' | 'streaming'
	availability: 'local' | 'remote'
	lastError: string | null
}

type DebugState = {
	role: 'server' | 'client' | 'undecided' | null
	transfers: DebugTransfer[]
}

type PeerHandle = {
	engine: BrowserEngine
	context: BrowserContext
	page: Page
}

type TwoPeerScenario = {
	title: string
	mainEngine: BrowserEngine
	clientEngine: BrowserEngine
	importer: 'main' | 'client'
	readyAvailability: 'local' | 'remote'
	readyMode?: 'local' | 'mirrored' | 'streaming'
}

type ThreePeerScenario = {
	title: string
	mainEngine: BrowserEngine
	ownerEngine: BrowserEngine
	lateJoinerEngine: BrowserEngine
}

const buildRoomUrl = (roomId: string, params: Record<string, string | number> = {}): string => {
	const search = new URLSearchParams({ signalUrl: SIGNAL_URL })
	for (const [key, value] of Object.entries(params)) {
		search.set(key, String(value))
	}
	return `${APP_URL}/?${search.toString()}#/${roomId}`
}

const readDebugState = async (page: Page): Promise<DebugState | null> =>
	page.evaluate(() => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				getRole: () => 'server' | 'client' | 'undecided' | null
				getResourceTransfers: () => DebugTransfer[]
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			return null
		}

		return {
			role: debug.getRole(),
			transfers: debug.getResourceTransfers(),
		}
	})

const getRole = async (page: Page): Promise<'server' | 'client' | 'undecided' | null> => {
	const state = await readDebugState(page)
	return state?.role ?? null
}

const getTransfers = async (page: Page): Promise<DebugTransfer[]> => {
	const state = await readDebugState(page)
	return state?.transfers ?? []
}

const createLargeVideoFile = async (): Promise<{ name: string; mimeType: string; buffer: Buffer }> => ({
	name: 'fixture-video.webm',
	mimeType: 'video/webm',
	buffer: await readFile(path.resolve('tests/fixtures/media/fixture-video.webm')),
})

const launchBrowser = async (engine: BrowserEngine): Promise<Browser> => {
	if (engine === 'firefox') {
		return firefox.launch()
	}
	return chromium.launch({ channel: 'msedge' })
}

const createEnginePool = () => {
	const browsers = new Map<BrowserEngine, Browser>()

	const getBrowser = async (engine: BrowserEngine): Promise<Browser> => {
		const existing = browsers.get(engine)
		if (existing) {
			return existing
		}

		const browser = await launchBrowser(engine)
		browsers.set(engine, browser)
		return browser
	}

	return {
		openPeer: async (engine: BrowserEngine, roomUrl: string): Promise<PeerHandle> => {
			const browser = await getBrowser(engine)
			const context = await browser.newContext()
			const page = await context.newPage()
			await page.goto(roomUrl)
			await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
			return { engine, context, page }
		},
		close: async (): Promise<void> => {
			await Promise.all([...browsers.values()].map((browser) => browser.close().catch(() => undefined)))
		},
	}
}

const waitForRole = async (peer: PeerHandle, role: 'server' | 'client'): Promise<void> => {
	await expect.poll(() => getRole(peer.page), {
		timeout: 20_000,
	}).toBe(role)
}

const waitForPartialTransfer = async (page: Page): Promise<void> => {
	await expect.poll(async () => {
		const transfers = await getTransfers(page)
		return transfers.some((transfer) => transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1)
	}, {
		timeout: 20_000,
	}).toBe(true)
}

const waitForReadyTransfer = async (
	page: Page,
	availability: 'local' | 'remote',
	mode?: 'local' | 'mirrored' | 'streaming',
): Promise<void> => {
	await expect.poll(() => getTransfers(page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability,
			status: 'ready',
			progress: 1,
			...(mode ? { mode } : {}),
			lastError: null,
		}) as DebugTransfer,
	]))
}

const waitForBlobPreview = async (page: Page): Promise<void> => {
	await expect.poll(async () => {
		const transfers = await getTransfers(page)
		return transfers[0]?.previewUrl ?? ''
	}, {
		timeout: 20_000,
	}).toMatch(/^blob:/)
}

const twoPeerScenarios: TwoPeerScenario[] = [
	{
		title: 'two-peer mixed-engine main-owned transfer from firefox main to edge client',
		mainEngine: 'firefox',
		clientEngine: 'msedge',
		importer: 'main',
		readyAvailability: 'remote',
		readyMode: 'streaming',
	},
	{
		title: 'two-peer mixed-engine main-owned transfer from edge main to firefox client',
		mainEngine: 'msedge',
		clientEngine: 'firefox',
		importer: 'main',
		readyAvailability: 'remote',
		readyMode: 'streaming',
	},
	{
		title: 'two-peer mixed-engine client-owned import from edge client to firefox main',
		mainEngine: 'firefox',
		clientEngine: 'msedge',
		importer: 'client',
		readyAvailability: 'remote',
	},
	{
		title: 'two-peer mixed-engine client-owned import from firefox client to edge main',
		mainEngine: 'msedge',
		clientEngine: 'firefox',
		importer: 'client',
		readyAvailability: 'remote',
	},
]

const threePeerScenarios: ThreePeerScenario[] = [
	{
		title: 'three-peer mixed-engine relay from edge owner through firefox main to firefox late joiner',
		mainEngine: 'firefox',
		ownerEngine: 'msedge',
		lateJoinerEngine: 'firefox',
	},
	{
		title: 'three-peer mixed-engine relay from edge owner through firefox main to edge late joiner',
		mainEngine: 'firefox',
		ownerEngine: 'msedge',
		lateJoinerEngine: 'msedge',
	},
	{
		title: 'three-peer mixed-engine relay from firefox owner through edge main to edge late joiner',
		mainEngine: 'msedge',
		ownerEngine: 'firefox',
		lateJoinerEngine: 'msedge',
	},
	{
		title: 'three-peer mixed-engine relay from firefox owner through edge main to firefox late joiner',
		mainEngine: 'msedge',
		ownerEngine: 'firefox',
		lateJoinerEngine: 'firefox',
	},
]

test.describe.configure({ mode: 'serial' })

for (const scenario of twoPeerScenarios) {
	test(scenario.title, async () => {
		test.setTimeout(60_000)

		const roomId = `p2p-mixed-two-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		const roomUrl = buildRoomUrl(roomId, {
			transferChunkSize: 512,
			transferChunkDelayMs: 250,
			transferHeadBytes: 512,
			transferPlayheadWindowSeconds: 0.5,
		})
		const videoFile = await createLargeVideoFile()
		const engines = createEnginePool()

		try {
			const mainPeer = await engines.openPeer(scenario.mainEngine, roomUrl)
			const clientPeer = await engines.openPeer(scenario.clientEngine, roomUrl)

			await waitForRole(mainPeer, 'server')
			await waitForRole(clientPeer, 'client')

			const importer = scenario.importer === 'main' ? mainPeer : clientPeer
			const observer = scenario.importer === 'main' ? clientPeer : mainPeer

			await importer.page.getByLabel('Import media files').setInputFiles(videoFile)

			await waitForPartialTransfer(observer.page)
			await waitForReadyTransfer(observer.page, scenario.readyAvailability, scenario.readyMode)
			await waitForBlobPreview(observer.page)
		} finally {
			await engines.close()
		}
	})
}

for (const scenario of threePeerScenarios) {
	test(scenario.title, async () => {
		test.setTimeout(75_000)

		const roomId = `p2p-mixed-three-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		const roomUrl = buildRoomUrl(roomId, {
			transferChunkSize: 512,
			transferChunkDelayMs: 250,
			transferHeadBytes: 512,
			transferPlayheadWindowSeconds: 0.5,
		})
		const videoFile = await createLargeVideoFile()
		const engines = createEnginePool()

		try {
			const mainPeer = await engines.openPeer(scenario.mainEngine, roomUrl)
			const ownerPeer = await engines.openPeer(scenario.ownerEngine, roomUrl)

			await waitForRole(mainPeer, 'server')
			await waitForRole(ownerPeer, 'client')

			await ownerPeer.page.getByLabel('Import media files').setInputFiles(videoFile)

			await waitForPartialTransfer(mainPeer.page)
			await waitForReadyTransfer(mainPeer.page, 'remote')

			await ownerPeer.context.close()

			const lateJoiner = await engines.openPeer(scenario.lateJoinerEngine, roomUrl)
			await waitForRole(lateJoiner, 'client')

			await waitForPartialTransfer(lateJoiner.page)
			await waitForReadyTransfer(lateJoiner.page, 'remote')
			await waitForBlobPreview(lateJoiner.page)
		} finally {
			await engines.close()
		}
	})
}