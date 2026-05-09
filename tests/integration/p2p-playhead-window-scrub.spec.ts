import { expect, test, type Page } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createFixtureVideo,
	createP2PRoomId,
	getRole,
	openP2PPeer,
	waitForRolePair,
} from './p2pTestHelpers'

const setTimelineCursor = async (page: Page, seconds: number): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline' })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const laneBox = await laneScroll.boundingBox()
	if (!laneBox) {
		throw new Error('Timeline lane scroll area is unavailable')
	}

	await laneScroll.click({
		position: {
			x: Math.max(8, seconds * zoom),
			y: Math.max(12, laneBox.height - 12),
		},
	})
}

test('scrubbing the remote timeline triggers a non-zero playhead window request', async ({ browser }) => {
	test.setTimeout(90_000)

	const roomId = createP2PRoomId('p2p-window-scrub', test.info().title)
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 256,
		transferChunkDelayMs: 700,
		transferHeadBytes: 256,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(second.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await waitForRolePair(first.page, second.page)

	const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
	const clientPage = serverPage === first.page ? second.page : first.page
	const videoFile = await createFixtureVideo()

	await serverPage.getByLabel('Import media files').setInputFiles(videoFile)

	const remoteRow = clientPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	await expect(remoteRow).toBeVisible()

	await remoteRow.getByRole('button', { name: 'Add to timeline' }).click()
	await expect(clientPage.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()

	await setTimelineCursor(clientPage, 0.75)
	await expect(clientPage.getByRole('region', { name: 'Timeline' }).getByLabel('Current time')).not.toHaveText('0.00s')
	await expect(clientPage.getByRole('region', { name: 'Preview panel' })).toContainText('fixture-video.webm')

	await closePeerHandles(first, second)
})
