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

test('p2p media import transfers to the remote peer and yields a blob preview', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-media', test.info().title)
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 250,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	await waitForRolePair(first.page, second.page)
	const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
	const clientPage = serverPage === first.page ? second.page : first.page
	const generatedVideo = await createFixtureVideo()

	await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
	const remoteRow = clientPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	await expect(remoteRow).toBeVisible()
	await remoteRow.getByRole('button', { name: 'Add to timeline' }).click()
	await expect(clientPage.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
	await expect(clientPage.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')

	await expect.poll(() => clientPage.locator('.ve-media-bin .ve-resource-row small').allTextContents(), {
		timeout: 20_000,
	}).toEqual(expect.arrayContaining([
		expect.stringMatching(/video\s*[|]\s*video\/webm\s*[|]\s*\d+\.\d+s/i),
		expect.stringMatching(/\d+\s*KB/i),
	]))

	await closePeerHandles(first, second)
})
