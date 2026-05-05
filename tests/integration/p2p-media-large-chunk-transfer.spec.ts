/**
 * Regression tests for cross-browser WebRTC DataChannel large-chunk transfer.
 *
 * Background: Chrome/Edge announces `a=max-message-size:262144` (256 KB) in SDP.
 * Firefox respects this limit and throws `RTCDataChannel.send: Message size (X) exceeds
 * maxMessageSize` when sending 1 MB ArrayBuffers — the production default chunk size.
 *
 * Fix: `createRawDcTransport` now fragments every binary send into ≤64 KB DataChannel
 * frames with a 9-byte header. The receiver reassembles before delivering to listeners.
 * This fragmentation is transparent to `P2PRawTransportLike` consumers.
 *
 * These tests exercise that fix with a ~3 MB synthetic fixture at the default 1 MB chunk
 * size (NO `transferChunkSize` URL param), covering both transfer directions.
 */

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { chromium, firefox, type Browser } from 'playwright'

const APP_URL = 'http://127.0.0.1:4174'
const SIGNAL_URL = 'http://127.0.0.1:8787'

/** Expected byte size of `tests/fixtures/media/fixture-3mb.webm`. */
const FIXTURE_SIZE_BYTES = 3 * 1024 * 1024 // 3 145 728

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
	requestEvents: Array<{
		reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'
		ranges: Array<[number, number]>
	}>
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

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const buildRoomUrl = (roomId: string, params: Record<string, string | number> = {}): string => {
	const search = new URLSearchParams({ signalUrl: SIGNAL_URL })
	for (const [key, value] of Object.entries(params)) {
		search.set(key, String(value))
	}
	return `${APP_URL}/?${search.toString()}#/${roomId}`
}

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

const readDebugState = async (page: Page): Promise<DebugState | null> =>
	page.evaluate(() => {
		const debug = (
			window as typeof window & {
				__MINICUT_P2P_DEBUG__?: {
					getRole: () => 'server' | 'client' | 'undecided' | null
					getResourceTransfers: () => DebugTransfer[]
				}
			}
		).__MINICUT_P2P_DEBUG__

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

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

const waitForRole = async (peer: PeerHandle, role: 'server' | 'client'): Promise<void> => {
	await expect
		.poll(() => getRole(peer.page), { timeout: 20_000 })
		.toBe(role)
}

const waitForProgressBeforeOrAtReady = async (page: Page): Promise<void> => {
	await expect
		.poll(
			async () => {
				const transfers = await getTransfers(page)
				return transfers.some((t) =>
					(t.status === 'partial' && t.progress > 0 && t.progress < 1)
					|| (t.status === 'ready' && t.progress === 1 && t.loadedBytes > 0),
				)
			},
			{ timeout: 60_000 },
		)
		.toBe(true)
}

const waitForReadyTransfer = async (page: Page): Promise<void> => {
	await expect
		.poll(() => getTransfers(page), { timeout: 60_000 })
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					availability: 'remote',
					status: 'ready',
					progress: 1,
					lastError: null,
				}) as DebugTransfer,
			]),
		)
}

/**
 * Fetch the blob URL from within the page context and return its byte size.
 * This proves that the assembled ArrayBuffer was actually delivered correctly.
 */
const fetchBlobSize = async (page: Page, blobUrl: string): Promise<number> =>
	page.evaluate(async (url) => {
		const response = await fetch(url)
		const buffer = await response.arrayBuffer()
		return buffer.byteLength
	}, blobUrl)

// ---------------------------------------------------------------------------
// Browser pool
// ---------------------------------------------------------------------------

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
			await Promise.all([...browsers.values()].map((b) => b.close().catch(() => undefined)))
		},
	}
}

// ---------------------------------------------------------------------------
// Shared fixture (loaded once per process)
// ---------------------------------------------------------------------------

const createFixture3mb = async (): Promise<{ name: string; mimeType: string; buffer: Buffer }> => ({
	name: 'fixture-3mb.webm',
	mimeType: 'video/webm',
	buffer: await readFile(path.resolve('tests/fixtures/media/fixture-3mb.webm')),
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' })

const directions: Array<{ title: string; mainEngine: BrowserEngine; clientEngine: BrowserEngine }> = [
	{
		title: 'large-chunk transfer: Firefox main → Edge client (1 MB chunks over DataChannel fragmentation)',
		mainEngine: 'firefox',
		clientEngine: 'msedge',
	},
	{
		title: 'large-chunk transfer: Edge main → Firefox client (1 MB chunks over DataChannel fragmentation)',
		mainEngine: 'msedge',
		clientEngine: 'firefox',
	},
]

for (const direction of directions) {
	test(direction.title, async () => {
		// 90 s — 3 MB at 1 MB chunks with intentional delay may take a moment in CI.
		test.setTimeout(90_000)

		const roomId = `p2p-large-chunk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		// Use default (1 MB) chunk size — no transferChunkSize param.
		// A 250 ms inter-chunk delay makes the partial→ready progression observable.
		const roomUrl = buildRoomUrl(roomId, {
			transferChunkDelayMs: 250,
		})

		const fixture3mb = await createFixture3mb()
		const engines = createEnginePool()
		try {
			const mainPeer = await engines.openPeer(direction.mainEngine, roomUrl)
			const clientPeer = await engines.openPeer(direction.clientEngine, roomUrl)

			await waitForRole(mainPeer, 'server')
			await waitForRole(clientPeer, 'client')

			// Import the 3 MB fixture on the main (server) peer.
			await mainPeer.page.getByLabel('Import media files').setInputFiles(fixture3mb)

			// --- Verify progress moves off zero, even if the transfer reaches ready quickly ---
			await waitForProgressBeforeOrAtReady(clientPeer.page)

			// --- Verify full transfer completes with no errors ---
			await waitForReadyTransfer(clientPeer.page)

			// Confirm the blob URL resolves to exactly the expected byte count.
			// This proves the DataChannel fragments were reassembled correctly.
			const transfers = await getTransfers(clientPeer.page)
			const transfer = transfers.find((t) => t.status === 'ready')
			expect(transfer).toBeDefined()
			expect(transfer!.totalBytes).toBe(FIXTURE_SIZE_BYTES)
			expect(transfer!.loadedBytes).toBe(FIXTURE_SIZE_BYTES)
			expect(transfer!.lastError).toBeNull()
			expect(transfer!.previewUrl).toMatch(/^blob:/)

			const blobSize = await fetchBlobSize(clientPeer.page, transfer!.previewUrl)
			expect(blobSize).toBe(FIXTURE_SIZE_BYTES)
		} finally {
			await engines.close()
		}
	})
}
