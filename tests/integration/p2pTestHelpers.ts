import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

const SIGNAL_URL = 'http://127.0.0.1:8787'

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

export const readP2PTrace = async (page: Page): Promise<unknown[]> =>
	page.evaluate(() => {
		const trace = (globalThis as typeof globalThis & {
			__MINICUT_P2P_TRACE__?: unknown[]
		}).__MINICUT_P2P_TRACE__
		return Array.isArray(trace) ? trace : []
	})

export const readP2PDeepDebugState = async (page: Page): Promise<unknown> =>
	page.evaluate(async () => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				getRole?: () => 'server' | 'client' | 'undecided' | null
				getProjectCount?: () => number
				getProjectTitles?: () => string[]
				getPeerId?: () => string | null
				isRuntimeReady?: () => boolean
				dumpGraphSummary?: () => unknown
				dumpProjectState?: () => unknown
				dumpWorkerState?: () => Promise<unknown>
				getRuntimeMessages?: () => unknown[]
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			return null
		}

		const workerState = debug.dumpWorkerState
			? await Promise.race([
				debug.dumpWorkerState(),
				new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 10_000)),
			]).catch((error: unknown) => ({
				error: error instanceof Error ? error.stack || error.message : String(error),
			}))
			: null

		return {
			role: debug.getRole?.() ?? null,
			projectCount: debug.getProjectCount?.(),
			projectTitles: debug.getProjectTitles?.(),
			peerId: debug.getPeerId?.(),
			runtimeReady: debug.isRuntimeReady?.(),
			graphSummary: debug.dumpGraphSummary?.(),
			projectState: debug.dumpProjectState?.(),
			runtimeMessages: debug.getRuntimeMessages?.() ?? [],
			workerState,
			p2pTrace: (globalThis as typeof globalThis & {
				__MINICUT_P2P_TRACE__?: unknown[]
			}).__MINICUT_P2P_TRACE__ ?? [],
		}
	})

export const writeP2PDebugArtifacts = async (
	label: string,
	firstPage: Page,
	secondPage: Page,
): Promise<string> => {
	const dir = path.join('test-results', 'p2p-debug')
	await mkdir(dir, { recursive: true })
	const filePath = path.join(
		dir,
		`${label.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}.json`,
	)
	const [first, second] = await Promise.all([
		readP2PDeepDebugState(firstPage).catch((error: unknown) => ({
			error: error instanceof Error ? error.stack || error.message : String(error),
		})),
		readP2PDeepDebugState(secondPage).catch((error: unknown) => ({
			error: error instanceof Error ? error.stack || error.message : String(error),
		})),
	])
	await writeFile(filePath, `${JSON.stringify({ first, second }, null, 2)}\n`, 'utf8')
	return filePath
}

const slugify = (value: string): string => value
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-+|-+$/g, '')
	.slice(0, 64) || 'room'

export const createP2PRoomId = (
	prefix: string,
	info: Pick<TestInfo, 'title' | 'workerIndex' | 'repeatEachIndex' | 'retry'>,
): string =>
	[
		prefix,
		slugify(info.title),
		`w${info.workerIndex}`,
		`r${info.repeatEachIndex}`,
		`retry${info.retry}`,
		randomUUID().slice(0, 8),
	].join('-')

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

export const getPeerId = async (page: Page): Promise<string | null> => {
	const state = await readP2PDebugState(page)
	return state?.peerId ?? null
}

export const isRuntimeReady = async (page: Page): Promise<boolean> => {
	const state = await readP2PDebugState(page)
	return state?.runtimeReady ?? false
}

export const openP2PPeer = async (browser: Browser, roomUrl: string): Promise<PeerHandle> => {
	const context = await browser.newContext({
		storageState: { cookies: [], origins: [] },
	})
	const page = await context.newPage()
	await page.goto(roomUrl)
	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	return { context, page }
}

export const closePeerHandles = async (...handles: Array<PeerHandle | null | undefined>): Promise<void> => {
	await Promise.all(handles.flatMap((handle) =>
		handle ? [handle.context.close().catch(() => undefined)] : [],
	))
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
	let lastStates: unknown = null
	try {
		await expect.poll(async () => {
			const [first, second] = await Promise.all([
				readP2PDebugState(firstPage),
				readP2PDebugState(secondPage),
			])
			lastStates = { first, second }
			const firstCount = first?.projectCount ?? 0
			const secondCount = second?.projectCount ?? 0
			return firstCount > 0 && firstCount === secondCount
		}, {
			timeout: 20_000,
		}).toBe(true)
	} catch (error) {
		const artifactPath = await writeP2PDebugArtifacts(
			'project-count-sync-timeout',
			firstPage,
			secondPage,
		).catch((artifactError: unknown) =>
			`<failed to write debug artifact: ${
				artifactError instanceof Error
					? artifactError.message
					: String(artifactError)
			}>`,
		)
		throw new Error(
			`Timed out waiting for P2P project count sync. Last states: ${JSON.stringify(lastStates)} Debug artifact: ${artifactPath}`,
			{ cause: error },
		)
	}

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
