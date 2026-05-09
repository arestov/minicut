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

const scenarios = [
	{
		title: 'two-peer relay smoke: main imports media',
		importer: 'main' as const,
		peers: 2,
	},
	{
		title: 'three-peer relay smoke: client imports media and late joiner catches up',
		importer: 'client' as const,
		peers: 3,
	},
]

for (const scenario of scenarios) {
	test(scenario.title, async ({ browser }) => {
		test.setTimeout(75_000)

		const roomId = createP2PRoomId('p2p-relay-smoke', test.info())
		const roomUrl = buildRoomUrl(roomId, {
			transferChunkSize: 512,
			transferChunkDelayMs: 250,
			transferHeadBytes: 512,
			transferPlayheadWindowSeconds: 0.5,
		})
		const videoFile = await createFixtureVideo()

		if (scenario.peers === 2) {
			const first = await openP2PPeer(browser, roomUrl)
			const second = await openP2PPeer(browser, roomUrl)

			try {
				await waitForRolePair(first.page, second.page)
				const mainPeer = await getRole(first.page) === 'server' ? first : second
				const clientPeer = mainPeer === first ? second : first
				const importer = scenario.importer === 'main' ? mainPeer : clientPeer
				const observer = scenario.importer === 'main' ? clientPeer : mainPeer

				await importer.page.getByLabel('Import media files').setInputFiles(videoFile)
				const observerRow = observer.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
				await expect(observerRow).toBeVisible()
				await observerRow.getByRole('button', { name: 'Add to timeline' }).click()
				await expect(observer.page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
				await expect(observer.page.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')
			} finally {
				await closePeerHandles(first, second)
			}
			return
		}

		const first = await openP2PPeer(browser, roomUrl)
		const second = await openP2PPeer(browser, roomUrl)
		const third = await openP2PPeer(browser, roomUrl)

		try {
			await Promise.all([first.page, second.page, third.page].map(async (page) => {
				await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
			}))
			const peers = [first, second, third]
			await waitForRolePair(first.page, second.page)
			const roles = await Promise.all(peers.map(({ page }) => getRole(page)))
			const serverPeer = peers[roles.findIndex((role) => role === 'server')]
			const clientPeers = peers.filter((_peer, index) => index !== roles.findIndex((role) => role === 'server'))
			const importer = scenario.importer === 'main' ? serverPeer : clientPeers[0]
			const observer = scenario.importer === 'main' ? clientPeers[0] : serverPeer

			await importer.page.getByLabel('Import media files').setInputFiles(videoFile)
			const observerRow = observer.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
			await expect(observerRow).toBeVisible()
			await observerRow.getByRole('button', { name: 'Add to timeline' }).click()
			await expect(observer.page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
			await expect(observer.page.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')
		} finally {
			await closePeerHandles(first, second, third)
		}
	})
}
