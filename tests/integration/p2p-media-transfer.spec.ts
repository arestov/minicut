import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const SIGNAL_URL = encodeURIComponent('http://127.0.0.1:8787')

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
	status: 'missing' | 'requesting' | 'partial' | 'ready' | 'error'
	progress: number
	previewUrl: string
	loadedRanges: Array<[number, number]>
	requestedRanges: Array<[number, number]>
	requestedRangesLog: Array<[number, number]>
	requestEvents: Array<{
		reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'
		ranges: Array<[number, number]>
		requestId?: string
		phase?: 'request' | 'chunk-meta' | 'chunk-complete' | 'error'
	}>
	mode: 'local' | 'mirrored' | 'streaming'
	availability: 'local' | 'remote'
}

type DebugState = {
	role: 'server' | 'client' | 'undecided' | null
	transfers: DebugTransfer[]
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
	buffer: Buffer.from(await import('node:fs/promises').then(({ readFile }) => readFile(path.resolve('tests/fixtures/media/fixture-video.webm')))),
})

test('p2p media import transfers to the remote peer and yields a blob preview', async ({ browser }) => {
	const roomId = `p2p-media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const firstContext = await browser.newContext()
	const secondContext = await browser.newContext()
	const firstPage = await firstContext.newPage()
	const secondPage = await secondContext.newPage()

	await Promise.all([firstPage.goto(roomUrl), secondPage.goto(roomUrl)])
	await expect(firstPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'minicut' })).toBeVisible()

	await expect.poll(async () => {
		const roles = await Promise.all([getRole(firstPage), getRole(secondPage)])
		return roles.includes('server') && roles.includes('client')
	}, {
		timeout: 20_000,
	}).toBe(true)

	const serverPage = await getRole(firstPage) === 'server' ? firstPage : secondPage
	const clientPage = serverPage === firstPage ? secondPage : firstPage
	const generatedVideo = await createLargeVideoFile()

	await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)

	await expect.poll(async () => {
		const transfers = await getTransfers(clientPage)
		return transfers.some((transfer) => {
			const hasRequest = transfer.requestEvents.some((event) => event.phase === 'request' && typeof event.requestId === 'string')
			const hasChunk = transfer.requestEvents.some((event) => event.phase === 'chunk-meta' && typeof event.requestId === 'string')
			const hasVisiblePartial = transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1
			const hasLoadedBytes = transfer.loadedBytes > 0
			return hasRequest && hasChunk && (hasVisiblePartial || hasLoadedBytes)
		})
	}, {
		timeout: 20_000,
	}).toBe(true)

	await expect.poll(() => getTransfers(serverPage), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability: 'local',
			status: 'ready',
			progress: 1,
		}) as DebugTransfer,
	]))

	await expect.poll(() => getTransfers(clientPage), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability: 'remote',
			mode: 'streaming',
			status: 'ready',
			progress: 1,
		}) as DebugTransfer,
	]))

	await expect.poll(async () => {
		const transfers = await getTransfers(clientPage)
		return transfers[0]?.previewUrl ?? ''
	}, {
		timeout: 20_000,
	}).toMatch(/^blob:/)

	await expect.poll(() => clientPage.locator('.ve-media-bin .ve-resource-row small').allTextContents(), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.stringMatching(/streaming\s*[·|]\s*ready\s*[·|]\s*100%/i),
	]))

	await expect.poll(() => clientPage.locator('.ve-renderer__layer video').evaluate((node) => (node as HTMLVideoElement).currentSrc), {
		timeout: 20_000,
	}).toMatch(/^blob:/)

	await Promise.all([firstContext.close(), secondContext.close()])
})
