import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createP2PRoomId,
	createProject,
	createProjectEventually,
	expectProjectTitlesContain,
	getProjectCount,
	getRole,
	openP2PPeer,
	waitForP2PDebugState,
	waitForProjectCountSync,
	waitForRolePair,
	waitForRuntimeReady,
} from './p2pTestHelpers'

test('p2p failover keeps room writable and admits new peers', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-failover', test.info().title)
	const roomUrl = buildRoomUrl(roomId)

	const peerA = await openP2PPeer(browser, roomUrl)
	const peerB = await openP2PPeer(browser, roomUrl)

	await Promise.all([waitForP2PDebugState(peerA.page), waitForP2PDebugState(peerB.page)])
	await waitForRolePair(peerA.page, peerB.page)
	const firstRole = await getRole(peerA.page)
	const currentServer = firstRole === 'server' ? peerA : peerB
	const currentClient = firstRole === 'server' ? peerB : peerA
	const beforeFailoverTitle = `before-failover-${roomId}`
	const afterFailoverTitle = `after-failover-${roomId}`

	const baselineCount = await waitForProjectCountSync(currentServer.page, currentClient.page)
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

	const lateJoiner = await openP2PPeer(browser, roomUrl)
	await expect.poll(() => getRole(lateJoiner.page), {
		timeout: 20_000,
	}).toBe('client')

	const expectedCountAfterFailover = await getProjectCount(currentClient.page)
	await expect.poll(() => getProjectCount(lateJoiner.page), {
		timeout: 20_000,
	}).toBe(expectedCountAfterFailover)
	await expectProjectTitlesContain(lateJoiner.page, [afterFailoverTitle])

	await closePeerHandles(currentClient, lateJoiner)
})

test('p2p survives two consecutive leader failovers across three peers', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-three-peer', test.info().title)
	const roomUrl = buildRoomUrl(roomId)
	const titles = [
		`epoch-1-${roomId}`,
		`epoch-2-${roomId}`,
		`epoch-3-${roomId}`,
	]

	const peers = await Promise.all([openP2PPeer(browser, roomUrl), openP2PPeer(browser, roomUrl), openP2PPeer(browser, roomUrl)])
	await Promise.all(peers.map(({ page }) => waitForP2PDebugState(page)))

	const splitPeersByRole = async (handles: typeof peers): Promise<{ server: typeof peers[number]; clients: typeof peers }> => {
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

	await closePeerHandles(...activePeers)
})
