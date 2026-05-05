import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

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
	totalBytes: number
	loadedBytes: number
	previewUrl: string
	requestedRangesLog: Array<[number, number]>
	requestEvents: Array<{ reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'; ranges: Array<[number, number]> }>
	lastError: string | null
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
	name: 'fixture-3mb.webm',
	mimeType: 'video/webm',
	buffer: await readFile(path.resolve('tests/fixtures/media/fixture-3mb.webm')),
})

test('large-file preview uses head-first partial blob and bounded sequential requests', async ({ browser }) => {
	test.setTimeout(90_000)

	const roomId = `p2p-large-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkDelayMs: 1200,
		transferHeadBytes: 1024 * 1024,
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
	}, { timeout: 20_000 }).toBe(true)

	const serverPage = await getRole(firstPage) === 'server' ? firstPage : secondPage
	const clientPage = serverPage === firstPage ? secondPage : firstPage
	const generatedVideo = await createLargeVideoFile()

	await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)

	await expect.poll(async () => (await getTransfers(clientPage))[0]?.requestEvents ?? [], { timeout: 20_000 }).toEqual(expect.arrayContaining([
		expect.objectContaining({
			reason: 'head',
			ranges: [[0, 1024 * 1024]],
		}),
	]))

	await expect.poll(async () => (await getTransfers(clientPage))[0], { timeout: 30_000 }).toMatchObject({
		status: 'ready',
		progress: 1,
		loadedBytes: 3 * 1024 * 1024,
		totalBytes: 3 * 1024 * 1024,
		previewUrl: expect.stringMatching(/^blob:/),
		lastError: null,
	})

	const completedTransfer = (await getTransfers(clientPage))[0]
	expect(completedTransfer?.requestEvents.some((event) =>
		event.reason === 'sequential' && JSON.stringify(event.ranges) === JSON.stringify([[1024 * 1024, 3 * 1024 * 1024]]),
	)).toBe(false)
	expect(completedTransfer?.requestEvents).toEqual(expect.arrayContaining([
		expect.objectContaining({
			ranges: [[1024 * 1024, 2 * 1024 * 1024]],
		}),
		expect.objectContaining({
			ranges: [[1024 * 1024, 2 * 1024 * 1024]],
		}),
		expect.objectContaining({
			ranges: [[2 * 1024 * 1024, 3 * 1024 * 1024]],
		}),
	]))

	await Promise.all([firstContext.close(), secondContext.close()])
})
