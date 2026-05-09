import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createP2PRoomId,
	createProject,
	getProjectCount,
	openP2PPeer,
	waitForP2PDebugState,
	waitForProjectCountSync,
	waitForRolePair,
} from './p2pTestHelpers'

test('p2p state sync works over WebRTC across isolated browser contexts', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-sync', test.info().title)
	const roomUrl = buildRoomUrl(roomId)
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(second.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await Promise.all([waitForP2PDebugState(first.page), waitForP2PDebugState(second.page)])

	await waitForRolePair(first.page, second.page)
	const syncedBeforeCount = await waitForProjectCountSync(first.page, second.page)
	expect(syncedBeforeCount).toBe(1)

	await createProject(first.page)
	await expect.poll(() => getProjectCount(first.page), {
		timeout: 20_000,
	}).toBeGreaterThan(syncedBeforeCount)

	const expectedCount = await getProjectCount(first.page)
	await expect.poll(() => getProjectCount(second.page), {
		timeout: 20_000,
	}).toBe(expectedCount)

	await closePeerHandles(first, second)
})
