import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const SIGNAL_URL = encodeURIComponent('http://127.0.0.1:8787')

const buildRoomUrl = (roomId: string): string => `/?signalUrl=${SIGNAL_URL}#/${roomId}`

type DebugState = {
	projectCount: number
	role: 'server' | 'client' | 'undecided' | null
	peerId: string | null
	projectTitles: string[]
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
				getProjectTitles: () => string[]
				getRole: () => 'server' | 'client' | 'undecided' | null
				getPeerId: () => string | null
			}
		}).__MINICUT_P2P_DEBUG__

		if (!debug) {
			return null
		}

		return {
			projectCount: debug.getProjectCount(),
			projectTitles: debug.getProjectTitles(),
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

const getProjectTitles = async (page: Page): Promise<string[]> => {
	const state = await readDebugState(page)
	return state?.projectTitles ?? []
}

const createProject = async (page: Page, title?: string): Promise<void> => {
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

const waitForRuntimeReady = async (page: Page): Promise<void> => {
	await expect.poll(
		() => page.evaluate(() => {
			const debug = (window as typeof window & {
				__MINICUT_P2P_DEBUG__?: { isRuntimeReady: () => boolean }
			}).__MINICUT_P2P_DEBUG__
			return debug?.isRuntimeReady() ?? false
		}),
		{ timeout: 20_000 },
	).toBe(true)
}

const createProjectEventually = async (page: Page, title?: string): Promise<void> => {
	const timeoutAt = Date.now() + 20_000
	let lastError: unknown = null

	while (Date.now() < timeoutAt) {
		try {
			await createProject(page, title)
			return
		} catch (error) {
			lastError = error
			await sleep(300)
		}
	}

	throw lastError instanceof Error ? lastError : new Error('Failed to create project after failover recovery window')
}

const expectProjectTitlesContain = async (page: Page, expectedTitles: string[]): Promise<void> => {
	await expect.poll(() => getProjectTitles(page), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining(expectedTitles))
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
	const beforeFailoverTitle = `before-failover-${roomId}`
	const afterFailoverTitle = `after-failover-${roomId}`

	const baselineCount = await waitForSyncedProjectCount(currentServer.page, currentClient.page)
	expect(baselineCount).toBe(1)
	await createProject(currentServer.page, beforeFailoverTitle)
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
	await waitForRuntimeReady(currentClient.page)

	const afterFailoverBaseline = await getProjectCount(currentClient.page)
	await createProjectEventually(currentClient.page, afterFailoverTitle)
	await expect.poll(() => getProjectCount(currentClient.page), {
		timeout: 20_000,
	}).toBeGreaterThan(afterFailoverBaseline)
	await expectProjectTitlesContain(currentClient.page, [afterFailoverTitle])
	await expect.poll(() => getProjectTitles(currentClient.page), {
		timeout: 20_000,
	}).not.toEqual(expect.arrayContaining([beforeFailoverTitle]))

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
	await expectProjectTitlesContain(lateJoinerPage, [afterFailoverTitle])
	await expect.poll(() => getProjectTitles(lateJoinerPage), {
		timeout: 20_000,
	}).not.toEqual(expect.arrayContaining([beforeFailoverTitle]))

	await Promise.all([currentClient.context.close(), lateJoinerContext.close()])
})

test('p2p survives two consecutive leader failovers across three peers', async ({ browser }) => {
	const roomId = `p2p-three-peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const roomUrl = buildRoomUrl(roomId)
	const titles = [
		`epoch-1-${roomId}`,
		`epoch-2-${roomId}`,
		`epoch-3-${roomId}`,
	]

	const peerContexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
	const peers: PeerHandle[] = await Promise.all(peerContexts.map(async (context) => ({
		context,
		page: await context.newPage(),
	})))

	await Promise.all(peers.map(({ page }) => page.goto(roomUrl)))
	await Promise.all(peers.map(async ({ page }) => {
		await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await waitForDebugState(page)
	}))

	const splitPeersByRole = async (handles: PeerHandle[]): Promise<{ server: PeerHandle; clients: PeerHandle[] }> => {
		await expect.poll(async () => {
			const roles = await Promise.all(handles.map(({ page }) => getRole(page)))
			return roles.filter((role) => role === 'server').length === 1 && roles.filter((role) => role === 'client').length === handles.length - 1
		}, {
			timeout: 20_000,
		}).toBe(true)

		const roles = await Promise.all(handles.map(({ page }) => getRole(page)))
		const serverIndex = roles.findIndex((role) => role === 'server')
		return {
			server: handles[serverIndex],
			clients: handles.filter((_peer, index) => index !== serverIndex),
		}
	}

	let activePeers = [...peers]
	let active = await splitPeersByRole(activePeers)
	await createProject(active.server.page, titles[0])
	await Promise.all(active.clients.map(({ page }) => expectProjectTitlesContain(page, [titles[0]])))

	await active.server.context.close()
	activePeers = active.clients
	active = await splitPeersByRole(activePeers)
	await waitForRuntimeReady(active.server.page)
	await createProjectEventually(active.server.page, titles[1])
	await Promise.all(active.clients.map(async ({ page }) => {
		await waitForRuntimeReady(page)
		await expectProjectTitlesContain(page, [titles[1]])
	}))

	await active.server.context.close()
	activePeers = active.clients
	await expect.poll(() => getRole(activePeers[0].page), {
		timeout: 20_000,
	}).toBe('server')
	await waitForRuntimeReady(activePeers[0].page)
	await createProjectEventually(activePeers[0].page, titles[2])
	await expectProjectTitlesContain(activePeers[0].page, [titles[2]])

	await activePeers[0].context.close()
})
