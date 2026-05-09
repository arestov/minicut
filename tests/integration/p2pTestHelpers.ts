import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

const SIGNAL_URL = 'http://127.0.0.1:8787'
let roomSequence = 0

export type DebugTransfer = {
	resourceId: string
	name: string
	ownerPeerId?: string | null
	status: 'missing' | 'requesting' | 'partial' | 'ready' | 'error'
	progress: number
	totalBytes?: number
	loadedBytes?: number
	previewUrl: string
	loadedRanges?: Array<[number, number]>
	requestedRanges?: Array<[number, number]>
	requestedRangesLog?: Array<[number, number]>
	requestEvents: Array<{
		reason: 'head' | 'tail' | 'window' | 'sequential' | 'replication'
		ranges: Array<[number, number]>
		requestId?: string
		phase?: 'request' | 'chunk-meta' | 'chunk-complete' | 'error'
	}>
	mode: 'local' | 'mirrored' | 'streaming'
	availability: 'local' | 'remote'
	lastError?: string | null
}

export type DebugState = {
	role: 'server' | 'client' | 'undecided' | null
	transfers?: DebugTransfer[]
	projectCount?: number
	projectTitles?: string[]
	peerId?: string | null
	runtimeReady?: boolean
}

export type PeerHandle = {
	context: BrowserContext
	page: Page
}

const slugify = (value: string): string => value
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-+|-+$/g, '')
	.slice(0, 64) || 'room'

export const createP2PRoomId = (prefix: string, seed: string): string =>
	`${prefix}-${slugify(seed)}-${++roomSequence}`

export const buildRoomUrl = (
	roomId: string,
	params: Record<string, string | number> = {},
	appUrl?: string,
): string => {
	const search = new URLSearchParams({ signalUrl: SIGNAL_URL })
	for (const [key, value] of Object.entries(params)) {
		search.set(key, String(value))
	}
	const base = appUrl ? appUrl.replace(/\/$/, '') : ''
	return `${base}/?${search.toString()}#/${roomId}`
}

export const readP2PDebugState = async (page: Page): Promise<DebugState | null> =>
	page.evaluate(() => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				getRole?: () => 'server' | 'client' | 'undecided' | null
				getResourceTransfers?: () => DebugTransfer[]
				getProjectCount?: () => number
				getProjectTitles?: () => string[]
				getPeerId?: () => string | null
				isRuntimeReady?: () => boolean
				waitForRuntimeSettled?: () => Promise<void>
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			return null
		}

		return {
			role: debug.getRole?.() ?? null,
			transfers: debug.getResourceTransfers?.(),
			projectCount: debug.getProjectCount?.(),
			projectTitles: debug.getProjectTitles?.(),
			peerId: debug.getPeerId?.(),
			runtimeReady: debug.isRuntimeReady?.(),
		}
	})

export const waitForP2PDebugState = async (page: Page): Promise<void> => {
	await expect.poll(() => readP2PDebugState(page), {
		timeout: 20_000,
	}).not.toBeNull()
}

export const getRole = async (page: Page): Promise<'server' | 'client' | 'undecided' | null> => {
	const state = await readP2PDebugState(page)
	return state?.role ?? null
}

export const getTransfers = async (page: Page): Promise<DebugTransfer[]> => {
	const state = await readP2PDebugState(page)
	return state?.transfers ?? []
}

export const getProjectCount = async (page: Page): Promise<number> => {
	const state = await readP2PDebugState(page)
	return state?.projectCount ?? 0
}

export const getProjectTitles = async (page: Page): Promise<string[]> => {
	const state = await readP2PDebugState(page)
	return state?.projectTitles ?? []
}

export const isRuntimeReady = async (page: Page): Promise<boolean> => {
	const state = await readP2PDebugState(page)
	return state?.runtimeReady ?? false
}

export const openP2PPeer = async (browser: Browser, roomUrl: string): Promise<PeerHandle> => {
	const context = await browser.newContext()
	const page = await context.newPage()
	await page.goto(roomUrl)
	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	return { context, page }
}

export const closePeerHandles = async (...handles: Array<PeerHandle | null | undefined>): Promise<void> => {
	await Promise.all(handles.filter(Boolean).map((handle) => handle!.context.close().catch(() => undefined)))
}

export const waitForRolePair = async (firstPage: Page, secondPage: Page): Promise<void> => {
	await expect.poll(async () => {
		const roles = await Promise.all([getRole(firstPage), getRole(secondPage)])
		return roles.includes('server') && roles.includes('client')
	}, {
		timeout: 20_000,
	}).toBe(true)
}

export const waitForProjectCountSync = async (firstPage: Page, secondPage: Page): Promise<number> => {
	await expect.poll(async () => {
		const firstCount = await getProjectCount(firstPage)
		const secondCount = await getProjectCount(secondPage)
		return firstCount > 0 && firstCount === secondCount
	}, {
		timeout: 20_000,
	}).toBe(true)

	return getProjectCount(firstPage)
}

export const waitForRuntimeReady = async (page: Page): Promise<void> => {
	await expect.poll(() => isRuntimeReady(page), {
		timeout: 20_000,
	}).toBe(true)
}

export const waitForRuntimeSettled = async (page: Page): Promise<void> => {
	await page.evaluate(async () => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				waitForRuntimeSettled?: () => Promise<void>
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug?.waitForRuntimeSettled) {
			throw new Error('P2P debug bridge is unavailable')
		}

		await debug.waitForRuntimeSettled()
	})
}

export const createProject = async (page: Page, title?: string): Promise<void> => {
	await page.evaluate(async (nextTitle) => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				dispatchCreateProject: (title?: string) => Promise<unknown>
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			throw new Error('P2P debug bridge is unavailable')
		}

		await debug.dispatchCreateProject(nextTitle)
	}, title)
}

export const createProjectEventually = async (page: Page, title?: string): Promise<void> => {
	await expect.poll(async () => {
		try {
			await createProject(page, title)
			return true
		} catch {
			return false
		}
	}, {
		timeout: 20_000,
	}).toBe(true)
}

export const expectProjectTitlesContain = async (page: Page, expectedTitles: string[]): Promise<void> => {
	await expect.poll(() => getProjectTitles(page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining(expectedTitles))
}

export const waitForProgressBeforeOrAtReady = async (page: Page): Promise<void> => {
	await expect.poll(async () => {
		const transfers = await getTransfers(page)
		return transfers.some((transfer) => {
			const hasRequest = transfer.requestEvents.some((event) => event.phase === 'request' && typeof event.requestId === 'string')
			const hasChunk = transfer.requestEvents.some((event) => event.phase === 'chunk-meta' && typeof event.requestId === 'string')
			const hasVisiblePartial = transfer.status === 'partial' && transfer.progress > 0 && transfer.progress < 1
			const hasLoadedBytes = (transfer.loadedBytes ?? 0) > 0
			return hasRequest && hasChunk && (hasVisiblePartial || hasLoadedBytes || transfer.status === 'ready')
		})
	}, {
		timeout: 20_000,
	}).toBe(true)
}

export const waitForLocalReadyTransfer = async (page: Page): Promise<void> => {
	await expect.poll(() => getTransfers(page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.objectContaining({
			availability: 'local',
			status: 'ready',
			progress: 1,
			lastError: null,
		}) as DebugTransfer,
	]))
}

export const waitForReadyTransfer = async (
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

export const waitForBlobPreview = async (page: Page): Promise<void> => {
	await expect.poll(async () => {
		const transfers = await getTransfers(page)
		return transfers[0]?.previewUrl ?? ''
	}, {
		timeout: 20_000,
	}).toMatch(/^blob:/)
}

export const createFixtureVideo = async (fileName = 'fixture-video.webm'): Promise<{ name: string; mimeType: string; buffer: Buffer }> => ({
	name: fileName,
	mimeType: 'video/webm',
	buffer: await readFile(path.resolve(`tests/fixtures/media/${fileName}`)),
})
