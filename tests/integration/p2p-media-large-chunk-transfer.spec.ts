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

const directions: Array<{ title: string; importer: 'main' | 'client' }> = [
	{
		title: 'large-chunk transfer smoke: main imports the 3 MB asset @slow',
		importer: 'main',
	},
	{
		title: 'large-chunk transfer smoke: client imports the 3 MB asset @slow',
		importer: 'client',
	},
]

for (const direction of directions) {
	test(direction.title, async ({ browser }) => {
		test.setTimeout(60_000)

		const roomId = createP2PRoomId('p2p-large-chunk', test.info())
		const roomUrl = buildRoomUrl(roomId, {
			transferChunkDelayMs: 250,
		})
		const fixture3mb = await createFixtureVideo('fixture-3mb.webm')
		const first = await openP2PPeer(browser, roomUrl)
		const second = await openP2PPeer(browser, roomUrl)

		try {
			await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
			await expect(second.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
			await waitForRolePair(first.page, second.page)

			const mainPeer = await getRole(first.page) === 'server' ? first : second
			const clientPeer = mainPeer === first ? second : first
			const importer = direction.importer === 'main' ? mainPeer : clientPeer
			const observer = direction.importer === 'main' ? clientPeer : mainPeer

			await importer.page.getByLabel('Import media files').setInputFiles(fixture3mb)

			const remoteRow = observer.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-3mb.webm' })
			await expect(remoteRow).toBeVisible()
			await remoteRow.getByRole('button', { name: 'Add to timeline' }).click()
			await expect(observer.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-3mb\.webm/i }).first()).toBeVisible()
			await expect(observer.page.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-3mb.webm')
		} finally {
			await closePeerHandles(first, second)
		}
	})
}
