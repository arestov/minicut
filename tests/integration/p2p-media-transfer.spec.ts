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
	requestedHistory: Array<[number, number]>
	requestEvents: Array<{ reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'; ranges: Array<[number, number]> }>
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

const createLargeVideoFile = async (
	page: Page,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> => {
	const result = await page.evaluate(async () => {
		const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']
			.find((candidate) => MediaRecorder.isTypeSupported(candidate))
		if (!mimeType) {
			throw new Error('MediaRecorder WebM is not supported in this browser')
		}

		const canvas = document.createElement('canvas')
		canvas.width = 640
		canvas.height = 360
		const context = canvas.getContext('2d')
		if (!context) {
			throw new Error('Unable to create video fixture canvas')
		}
		const stream = canvas.captureStream(12)
		const chunks: BlobPart[] = []
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: 3_000_000,
			audioBitsPerSecond: 128_000,
		})
		const stopped = new Promise<void>((resolve, reject) => {
			recorder.addEventListener('dataavailable', (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data)
				}
			})
			recorder.addEventListener('stop', () => resolve())
			recorder.addEventListener('error', () => reject(recorder.error ?? new Error('Fixture recorder failed')))
		})

		recorder.start(250)
		for (let frame = 0; frame < 36; frame += 1) {
			context.fillStyle = frame % 2 === 0 ? '#0f766e' : '#dc2626'
			context.fillRect(0, 0, canvas.width, canvas.height)
			context.fillStyle = '#ffffff'
			context.font = 'bold 72px sans-serif'
			context.fillText(`F${frame}`, 32 + (frame % 6) * 24, 180 + (frame % 4) * 12)
			await new Promise((resolve) => setTimeout(resolve, 120))
		}
		recorder.stop()
		for (const track of stream.getTracks()) {
			track.stop()
		}
		await stopped

		const blob = new Blob(chunks, { type: recorder.mimeType || mimeType })
		return { mimeType: blob.type || 'video/webm', bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
	})

	return { name: 'progressive-fixture.webm', mimeType: result.mimeType, buffer: Buffer.from(result.bytes) }
}

test('p2p media import transfers to the remote peer and yields a blob preview', async ({ browser }) => {
	const roomId = `p2p-media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 16384,
		transferChunkDelayMs: 250,
		transferHeadBytes: 16384,
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
	const generatedVideo = await createLargeVideoFile(serverPage)

	await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)

	await expect.poll(async () => {
		const transfers = await getTransfers(clientPage)
		return transfers.some((transfer) => transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1)
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
	}).toContain('streaming · ready · 100%')

	await expect.poll(() => clientPage.locator('.ve-renderer__layer video').evaluate((node) => (node as HTMLVideoElement).currentSrc), {
		timeout: 20_000,
	}).toMatch(/^blob:/)

	await Promise.all([firstContext.close(), secondContext.close()])
})
