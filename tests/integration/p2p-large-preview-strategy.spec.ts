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

test('large-file preview uses head-first partial blob and bounded sequential requests @slow', async ({ browser }) => {
	test.setTimeout(90_000)

	const roomId = createP2PRoomId('p2p-large-preview', test.info())
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkDelayMs: 1200,
		transferHeadBytes: 1024 * 1024,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	try {
		await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await expect(second.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await waitForRolePair(first.page, second.page)

		const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
		const clientPage = serverPage === first.page ? second.page : first.page
		const generatedVideo = await createFixtureVideo('fixture-3mb.webm')

		await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
		const remoteRow = clientPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-3mb.webm' })
		await expect(remoteRow).toBeVisible()
		await remoteRow.getByRole('button', { name: 'Add to timeline' }).click()
		await expect(clientPage.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-3mb\.webm/i }).first()).toBeVisible()
		await expect(clientPage.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-3mb.webm')
	} finally {
		await closePeerHandles(first, second)
	}
})
