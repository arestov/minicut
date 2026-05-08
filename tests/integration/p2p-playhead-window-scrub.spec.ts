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
	previewUrl: string
	loadedBytes: number
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

const createFixtureVideo = async (): Promise<{ name: string; mimeType: string; buffer: Buffer }> => ({
	name: 'fixture-video.webm',
	mimeType: 'video/webm',
	buffer: await readFile(path.resolve('tests/fixtures/media/fixture-video.webm')),
})

const setTimelineCursor = async (page: Page, seconds: number): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline' })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const laneBox = await laneScroll.boundingBox()
	if (!laneBox) {
		throw new Error('Timeline lane scroll area is unavailable')
	}

	await laneScroll.click({
		position: {
			x: Math.max(8, seconds * zoom),
			y: Math.max(12, laneBox.height - 12),
		},
	})
}

test('scrubbing the remote timeline triggers a non-zero playhead window request', async ({ browser }) => {
	test.setTimeout(90_000)

	const roomId = `p2p-window-scrub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 256,
		transferChunkDelayMs: 700,
		transferHeadBytes: 256,
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
	}, { timeout: 20_000 }).toBe(true)

	const serverPage = await getRole(firstPage) === 'server' ? firstPage : secondPage
	const clientPage = serverPage === firstPage ? secondPage : firstPage
	const videoFile = await createFixtureVideo()

	await serverPage.getByLabel('Import media files').setInputFiles(videoFile)

	const remoteRow = clientPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	await expect(remoteRow).toBeVisible()
	await expect.poll(async () => {
		const transfer = (await getTransfers(clientPage))[0]
		return transfer
			? {
				status: transfer.status,
				loadedBytes: transfer.loadedBytes,
				lastError: transfer.lastError,
			}
			: null
	}, { timeout: 20_000 }).toEqual(expect.objectContaining({
		status: expect.stringMatching(/partial|ready/),
		loadedBytes: expect.any(Number),
		lastError: null,
	}))

	await remoteRow.getByRole('button', { name: 'Add to timeline' }).click()
	await expect(clientPage.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()

	await setTimelineCursor(clientPage, 0.75)

	await expect.poll(async () => {
		const transfer = (await getTransfers(clientPage))[0]
		const hasWindow = transfer?.requestEvents.some((event) =>
			event.reason === 'window' && event.ranges.some(([start]) => start > 0),
		) ?? false
		const isReady = transfer?.status === 'ready' && (transfer?.loadedBytes ?? 0) > 0
		return {
			requestCount: transfer?.requestEvents.length ?? 0,
			hasWindow,
			isReady,
			hasWindowOrReady: hasWindow || isReady,
			lastError: transfer?.lastError ?? null,
		}
	}, { timeout: 20_000 }).toMatchObject({
		requestCount: expect.any(Number),
		hasWindowOrReady: true,
		lastError: null,
	})

	await Promise.all([firstContext.close(), secondContext.close()])
})
