import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createP2PRoomId,
	createProject,
	getPeerId,
	getProjectCount,
	readP2PTrace,
	openP2PPeer,
	waitForP2PDebugState,
	waitForProjectCountSync,
	waitForRolePair,
	writeP2PDebugArtifacts,
} from './p2pTestHelpers'

test('p2p state sync works over WebRTC across isolated browser contexts', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-sync', test.info())
	const roomUrl = buildRoomUrl(roomId)
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	try {
		await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await expect(second.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await Promise.all([waitForP2PDebugState(first.page), waitForP2PDebugState(second.page)])

		await waitForRolePair(first.page, second.page)
		const [firstPeerId, secondPeerId] = await Promise.all([
			getPeerId(first.page),
			getPeerId(second.page),
		])
		expect(firstPeerId).toBeTruthy()
		expect(secondPeerId).toBeTruthy()
		expect(firstPeerId).not.toBe(secondPeerId)

		const syncedBeforeCount = await waitForProjectCountSync(first.page, second.page)
		expect(syncedBeforeCount).toBeGreaterThan(0)

		await createProject(first.page)
		await expect.poll(() => getProjectCount(first.page), {
			timeout: 20_000,
		}).toBeGreaterThan(syncedBeforeCount)

		const expectedCount = await getProjectCount(first.page)
		try {
			await expect.poll(() => getProjectCount(second.page), {
				timeout: 20_000,
			}).toBe(expectedCount)
		} catch (error) {
			const artifactPath = await writeP2PDebugArtifacts(
				'project-count-post-create-timeout',
				first.page,
				second.page,
			)
			throw new Error(`Timed out waiting for post-create P2P sync. Debug artifact: ${artifactPath}`, { cause: error })
		}

		const [firstTrace, secondTrace] = await Promise.all([
			readP2PTrace(first.page),
			readP2PTrace(second.page),
		])
		const combinedTrace = [...firstTrace, ...secondTrace] as Array<Record<string, unknown>>
		expect(combinedTrace).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: expect.stringMatching(/crdt-(send|receive)/),
				}),
			]),
		)
		expect(combinedTrace).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ event: expect.stringMatching(/fake|inject/i) }),
			]),
		)
	} finally {
		await closePeerHandles(first, second)
	}
})
