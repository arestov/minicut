import { expect, test, type Page } from '@playwright/test'

const SIGNAL_URL = encodeURIComponent('http://127.0.0.1:8787')

const buildRoomUrl = (roomId: string): string => `/?signalUrl=${SIGNAL_URL}#/${roomId}`

type DebugState = {
	projectCount: number
	role: 'server' | 'client' | 'undecided' | null
	peerId: string | null
}

const readDebugState = async (page: Page): Promise<DebugState | null> =>
	page.evaluate(() => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				getProjectCount: () => number
				getRole: () => 'server' | 'client' | 'undecided' | null
				getPeerId: () => string | null
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			return null
		}

		return {
			projectCount: debug.getProjectCount(),
			role: debug.getRole(),
			peerId: debug.getPeerId(),
		}
	})

const waitForDebugState = async (page: Page): Promise<void> => {
	await expect.poll(() => readDebugState(page), {
		timeout: 20_000,
	}).not.toBeNull()
}

const getProjectCount = async (page: Page): Promise<number> => {
	const state = await readDebugState(page)
	return state?.projectCount ?? 0
}

const getRole = async (page: Page): Promise<'server' | 'client' | 'undecided' | null> => {
	const state = await readDebugState(page)
	return state?.role ?? null
}

const createProject = async (page: Page): Promise<void> => {
	await page.evaluate(async () => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				dispatchCreateProject: () => Promise<unknown>
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			throw new Error('P2P debug bridge is unavailable')
		}

		await debug.dispatchCreateProject()
	})
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
	setTimeout(resolve, ms)
})

const waitForSyncedProjectCount = async (firstPage: Page, secondPage: Page): Promise<number> => {
	const timeoutAt = Date.now() + 20_000
	let firstCount = 0
	let secondCount = 0
	let firstRole: string | null = null
	let secondRole: string | null = null

	while (Date.now() < timeoutAt) {
		firstCount = await getProjectCount(firstPage)
		secondCount = await getProjectCount(secondPage)
		firstRole = await getRole(firstPage)
		secondRole = await getRole(secondPage)
		if (firstCount > 0 && firstCount === secondCount) {
			return firstCount
		}

		await sleep(250)
	}

	throw new Error(`Project counts did not converge: first=${firstCount} second=${secondCount} roles=${firstRole}/${secondRole}`)
}

test('p2p state sync works over WebRTC across isolated browser contexts', async ({ browser }) => {
	const roomId = `p2p-sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId)
	const firstContext = await browser.newContext()
	const secondContext = await browser.newContext()
	const firstPage = await firstContext.newPage()
	const secondPage = await secondContext.newPage()

	await Promise.all([firstPage.goto(roomUrl), secondPage.goto(roomUrl)])
	await expect(firstPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'minicut' })).toBeVisible()

	await Promise.all([waitForDebugState(firstPage), waitForDebugState(secondPage)])

	await expect.poll(async () => {
		const firstRole = await getRole(firstPage)
		const secondRole = await getRole(secondPage)
		return (firstRole === 'server' && secondRole === 'client') || (firstRole === 'client' && secondRole === 'server')
	}, {
		timeout: 20_000,
	}).toBe(true)

	const syncedBeforeCount = await waitForSyncedProjectCount(firstPage, secondPage)
	expect(syncedBeforeCount).toBe(1)

	await createProject(firstPage)
	await expect.poll(() => getProjectCount(firstPage), {
		timeout: 20_000,
	}).toBeGreaterThan(syncedBeforeCount)

	const expectedCount = await getProjectCount(firstPage)
	await expect.poll(() => getProjectCount(secondPage), {
		timeout: 20_000,
	}).toBe(expectedCount)

	await Promise.all([firstContext.close(), secondContext.close()])
})
