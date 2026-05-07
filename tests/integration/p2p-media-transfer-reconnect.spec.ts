import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type Page } from '@playwright/test'

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
	buffer: await readFile(path.resolve('tests/fixtures/media/fixture-video.webm')),
})

const openRoomPage = async (browser: Browser, roomUrl: string) => {
	const context = await browser.newContext()
	const page = await context.newPage()
	await page.goto(roomUrl)
	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	return { context, page }
}

test('p2p media transfer resumes after the remote peer reconnects mid-transfer', async ({ browser }) => {
	const roomId = `p2p-media-reconnect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openRoomPage(browser, roomUrl)
	const second = await openRoomPage(browser, roomUrl)

	await expect.poll(async () => {
		const roles = await Promise.all([getRole(first.page), getRole(second.page)])
		return roles.includes('server') && roles.includes('client')
	}, {
		timeout: 20_000,
	}).toBe(true)

	const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
	const originalClient = serverPage === first.page ? second : first
	const generatedVideo = await createLargeVideoFile()

	await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)

	await expect.poll(async () => {
		const transfers = await getTransfers(originalClient.page)
		return transfers.some((transfer) => {
			const hasRequest = transfer.requestEvents.some((event) => event.phase === 'request' && typeof event.requestId === 'string')
			const hasChunk = transfer.requestEvents.some((event) => event.phase === 'chunk-meta' && typeof event.requestId === 'string')
			const hasVisiblePartial = transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1
			return hasRequest && hasChunk && (hasVisiblePartial || transfer.loadedBytes > 0)
		})
	}, {
		timeout: 20_000,
	}).toBe(true)

	await originalClient.context.close()

	const replacementClient = await openRoomPage(browser, roomUrl)

	await expect.poll(() => getRole(replacementClient.page), {
		timeout: 20_000,
	}).toBe('client')

	await expect.poll(() => getTransfers(replacementClient.page), {
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
		const transfers = await getTransfers(replacementClient.page)
		return transfers[0]?.previewUrl ?? ''
	}, {
		timeout: 20_000,
	}).toMatch(/^blob:/)

	await Promise.all([first.context.close(), second.context.close().catch(() => undefined), replacementClient.context.close()])
})