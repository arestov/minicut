import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const SIGNAL_URL = encodeURIComponent('http://127.0.0.1:8787')

const buildRoomUrl = (roomId: string): string => `/?signalUrl=${SIGNAL_URL}#/${roomId}`

type DebugState = {
	projectCount: number
	role: 'server' | 'client' | 'undecided' | null
	peerId: string | null
}

type PeerHandle = {
	context: BrowserContext
	page: Page
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

const waitForRoles = async (firstPage: Page, secondPage: Page): Promise<void> => {
	await expect.poll(async () => {
		const firstRole = await getRole(firstPage)
		const secondRole = await getRole(secondPage)
		return (firstRole === 'server' && secondRole === 'client') || (firstRole === 'client' && secondRole === 'server')
	}, {
		timeout: 20_000,
	}).toBe(true)
}

const createProjectEventually = async (page: Page): Promise<void> => {
	const timeoutAt = Date.now() + 20_000
	let lastError: unknown = null

	while (Date.now() < timeoutAt) {
		try {
			await createProject(page)
			return
		} catch (error) {
			lastError = error
			await sleep(300)
		}
	}

	throw lastError instanceof Error ? lastError : new Error('Failed to create project after failover recovery window')
}

test('p2p failover keeps room writable and admits new peers', async ({ browser }) => {
	const roomId = `p2p-failover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId)

	const peerAContext = await browser.newContext()
	const peerBContext = await browser.newContext()
	const peerA: PeerHandle = { context: peerAContext, page: await peerAContext.newPage() }
	const peerB: PeerHandle = { context: peerBContext, page: await peerBContext.newPage() }

	await Promise.all([peerA.page.goto(roomUrl), peerB.page.goto(roomUrl)])
	await expect(peerA.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(peerB.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await Promise.all([waitForDebugState(peerA.page), waitForDebugState(peerB.page)])

	await waitForRoles(peerA.page, peerB.page)
	const firstRole = await getRole(peerA.page)
	const currentServer = firstRole === 'server' ? peerA : peerB
	const currentClient = firstRole === 'server' ? peerB : peerA

	const baselineCount = await waitForSyncedProjectCount(currentServer.page, currentClient.page)
	await createProject(currentServer.page)
	await expect.poll(() => getProjectCount(currentServer.page), {
		timeout: 20_000,
	}).toBeGreaterThan(baselineCount)

	const syncedAfterServerMutation = await getProjectCount(currentServer.page)
	await expect.poll(() => getProjectCount(currentClient.page), {
		timeout: 20_000,
	}).toBe(syncedAfterServerMutation)

	await currentServer.context.close()

	await expect.poll(() => getRole(currentClient.page), {
		timeout: 20_000,
	}).toBe('server')

	const afterFailoverBaseline = await getProjectCount(currentClient.page)
	await createProjectEventually(currentClient.page)
	await expect.poll(() => getProjectCount(currentClient.page), {
		timeout: 20_000,
	}).toBeGreaterThan(afterFailoverBaseline)

	const lateJoinerContext = await browser.newContext()
	const lateJoinerPage = await lateJoinerContext.newPage()
	await lateJoinerPage.goto(roomUrl)
	await expect(lateJoinerPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await waitForDebugState(lateJoinerPage)
	await expect.poll(() => getRole(lateJoinerPage), {
		timeout: 20_000,
	}).toBe('client')

	const expectedCountAfterFailover = await getProjectCount(currentClient.page)
	await expect.poll(() => getProjectCount(lateJoinerPage), {
		timeout: 20_000,
	}).toBe(expectedCountAfterFailover)

	await Promise.all([currentClient.context.close(), lateJoinerContext.close()])
})
