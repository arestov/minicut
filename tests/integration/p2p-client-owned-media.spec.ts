import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createFixtureVideo,
	createP2PRoomId,
	getRole,
	openP2PPeer,
	selectSharedActiveProject,
	waitForReadyTransfer,
	waitForRolePair,
	writeP2PDebugArtifactsMany,
} from './p2pTestHelpers'

test('client-owned media imports transfer to main without sticking in error', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-client-owned', test.info())
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	try {
		await waitForRolePair(first.page, second.page)
		const serverPeer = await getRole(first.page) === 'server' ? first : second
		const clientPeer = serverPeer === first ? second : first
		const generatedVideo = await createFixtureVideo()

		await selectSharedActiveProject(serverPeer.page, clientPeer.page)
		await clientPeer.page.getByLabel('Import media files').setInputFiles(generatedVideo)
		const clientRow = clientPeer.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(clientRow).toBeVisible()
		await clientRow.getByRole('button', { name: 'Add to timeline' }).click()
		try {
			await expect(clientPeer.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
		} catch (error) {
			const artifactPath = await writeP2PDebugArtifactsMany('client-owned-media-add-timeout', [
				{ label: 'server', page: serverPeer.page },
				{ label: 'client', page: clientPeer.page },
			])
			throw new Error(`Timed out adding client-owned media to the timeline. Debug artifact: ${artifactPath}`, { cause: error })
		}
		await expect(serverPeer.page.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')
	} finally {
		await closePeerHandles(first, second)
	}
})

test('main relays a client-owned resource to a late joiner after the owner disconnects', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-client-owned-relay', test.info())
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)
	let lateJoiner: Awaited<ReturnType<typeof openP2PPeer>> | null = null

	try {
		await waitForRolePair(first.page, second.page)
		const serverPeer = await getRole(first.page) === 'server' ? first : second
		const ownerPeer = serverPeer === first ? second : first
		const generatedVideo = await createFixtureVideo()

		await selectSharedActiveProject(serverPeer.page, ownerPeer.page)
		await ownerPeer.page.getByLabel('Import media files').setInputFiles(generatedVideo)
		const serverRow = serverPeer.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(serverRow).toBeVisible()
		await waitForReadyTransfer(serverPeer.page, 'remote')

		await ownerPeer.context.close()

		lateJoiner = await openP2PPeer(browser, roomUrl)
		await expect.poll(() => getRole(lateJoiner.page), {
			timeout: 20_000,
		}).toBe('client')
		try {
			await selectSharedActiveProject(serverPeer.page, lateJoiner.page)
		} catch (error) {
			const artifactPath = await writeP2PDebugArtifactsMany('client-owned-relay-project-select-timeout', [
				{ label: 'server', page: serverPeer.page },
				{ label: 'lateJoiner', page: lateJoiner.page },
			])
			throw new Error(`Timed out selecting server project on late joiner. Debug artifact: ${artifactPath}`, { cause: error })
		}

		const lateJoinerRow = lateJoiner.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(lateJoinerRow).toBeVisible()
		await lateJoinerRow.getByRole('button', { name: 'Add to timeline' }).click()
		await expect(lateJoiner.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
		await expect(lateJoiner.page.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')
	} finally {
		await closePeerHandles(first, second, lateJoiner)
	}
})
