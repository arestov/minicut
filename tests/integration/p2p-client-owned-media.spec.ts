import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const buildRoomUrl = (roomId: string, params: Record<string, string | number> = {}): string => {
	const search = new URLSearchParams({ signalUrl: 'http://127.0.0.1:8787' })
	for (const [key, value] of Object.entries(params)) {
		search.set(key, String(value))
	}
	return `/?${search.toString()}#/${roomId}`
}

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
	requestedHistory: Array<[number, number]>
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
	context: BrowserContext
	page: Page
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

const openPeer = async (browser: Browser, roomUrl: string): Promise<PeerHandle> => {
	const context = await browser.newContext()
	const page = await context.newPage()
	await page.goto(roomUrl)
	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	return { context, page }
}

const waitForTwoPeerRoles = async (first: Page, second: Page): Promise<void> => {
	await expect.poll(async () => {
		const roles = await Promise.all([getRole(first), getRole(second)])
		return roles.includes('server') && roles.includes('client')
	}, {
		timeout: 20_000,
	}).toBe(true)
}

test('client-owned media imports transfer to main without sticking in error', async ({ browser }) => {
	const roomId = `p2p-client-owned-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openPeer(browser, roomUrl)
	const second = await openPeer(browser, roomUrl)

	await waitForTwoPeerRoles(first.page, second.page)
	const serverPeer = await getRole(first.page) === 'server' ? first : second
	const clientPeer = serverPeer === first ? second : first
	const generatedVideo = await createLargeVideoFile()

	await clientPeer.page.getByLabel('Import media files').setInputFiles(generatedVideo)

	await expect.poll(async () => {
		const transfers = await getTransfers(serverPeer.page)
		return transfers.some((transfer) => transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1)
	}, {
		timeout: 20_000,
	}).toBe(true)

	await expect.poll(() => getTransfers(serverPeer.page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability: 'remote',
			status: 'ready',
			progress: 1,
			lastError: null,
		}) as DebugTransfer,
	]))

	await Promise.all([first.context.close(), second.context.close()])
})

test('main relays a client-owned resource to a late joiner after the owner disconnects', async ({ browser }) => {
	const roomId = `p2p-client-owned-relay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openPeer(browser, roomUrl)
	const second = await openPeer(browser, roomUrl)

	await waitForTwoPeerRoles(first.page, second.page)
	const serverPeer = await getRole(first.page) === 'server' ? first : second
	const ownerPeer = serverPeer === first ? second : first
	const generatedVideo = await createLargeVideoFile()

	await ownerPeer.page.getByLabel('Import media files').setInputFiles(generatedVideo)

	await expect.poll(() => getTransfers(serverPeer.page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability: 'remote',
			status: 'ready',
			progress: 1,
			lastError: null,
		}) as DebugTransfer,
	]))

	await ownerPeer.context.close()

	const lateJoiner = await openPeer(browser, roomUrl)
	await expect.poll(() => getRole(lateJoiner.page), {
		timeout: 20_000,
	}).toBe('client')

	await expect.poll(async () => {
		const transfers = await getTransfers(lateJoiner.page)
		return transfers.some((transfer) => transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1)
	}, {
		timeout: 20_000,
	}).toBe(true)

	await expect.poll(() => getTransfers(lateJoiner.page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability: 'remote',
			status: 'ready',
			progress: 1,
			lastError: null,
		}) as DebugTransfer,
	]))

	await expect.poll(async () => {
		const transfers = await getTransfers(lateJoiner.page)
		return transfers[0]?.previewUrl ?? ''
	}, {
		timeout: 20_000,
	}).toMatch(/^blob:/)

	await Promise.all([serverPeer.context.close(), lateJoiner.context.close(), ownerPeer.context.close().catch(() => undefined)])
})