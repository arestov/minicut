import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createFixtureVideo,
	createP2PRoomId,
	getRole,
	openP2PPeer,
	waitForRolePair,
} from './p2pTestHelpers'

test('p2p media transfer resumes after the remote peer reconnects mid-transfer', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-media-reconnect', test.info().title)
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)
	let replacementClient: Awaited<ReturnType<typeof openP2PPeer>> | null = null

	try {
		await waitForRolePair(first.page, second.page)

		const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
		const originalClient = serverPage === first.page ? second : first
		const generatedVideo = await createFixtureVideo()

		await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
		const originalClientRow = originalClient.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(originalClientRow).toBeVisible()

		await originalClient.context.close()

		replacementClient = await openP2PPeer(browser, roomUrl)

		await expect.poll(() => getRole(replacementClient.page), {
			timeout: 20_000,
		}).toBe('client')

		const replacementRow = replacementClient.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(replacementRow).toBeVisible()
		await replacementRow.getByRole('button', { name: 'Add to timeline' }).click()
		await expect(replacementClient.page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
		await expect(replacementClient.page.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')
	} finally {
		await closePeerHandles(first, second, replacementClient)
	}
})
