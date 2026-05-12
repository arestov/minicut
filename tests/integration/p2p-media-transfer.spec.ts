import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createFixtureVideo,
	createProject,
	createP2PRoomId,
	getRole,
	openP2PPeer,
	waitForReadyTransfer,
	waitForRolePair,
} from './p2pTestHelpers'

const createRenamedFixtureVideo = async (name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> => {
	const fixture = await createFixtureVideo()
	return {
		...fixture,
		name,
	}
}

const getActiveProjectNodeId = async (page: import('@playwright/test').Page): Promise<string> => {
	const projectId = await page.evaluate(() => {
		const state = window.__MINICUT_P2P_DEBUG__?.dumpProjectState?.() as { activeProjectNodeId?: unknown } | null
		return typeof state?.activeProjectNodeId === 'string' ? state.activeProjectNodeId : null
	})
	if (!projectId) {
		throw new Error('Expected active project node id')
	}
	return projectId
}

const setActiveProject = async (page: import('@playwright/test').Page, projectId: string): Promise<void> => {
	await page.evaluate(async (nextProjectId) => {
		await window.__MINICUT_P2P_DEBUG__?.dispatchRootAction('setActiveProject', nextProjectId)
	}, projectId)
}

test('p2p media import transfers to the remote peer and yields a blob preview', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-media', test.info())
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
		const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
		const clientPage = serverPage === first.page ? second.page : first.page
		const generatedVideo = await createFixtureVideo()

		await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
		await setActiveProject(clientPage, await getActiveProjectNodeId(serverPage))
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
	} finally {
		await closePeerHandles(first, second)
	}
})

test('p2p timeline clip created on the main peer renders preview on the remote peer', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-main-timeline-preview', test.info())
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
		const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
		const clientPage = serverPage === first.page ? second.page : first.page
		const generatedVideo = await createFixtureVideo()

		await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
		await setActiveProject(clientPage, await getActiveProjectNodeId(serverPage))
		const serverRow = serverPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(serverRow).toBeVisible()
		await serverRow.getByRole('button', { name: 'Add to timeline' }).click()

		const clientTimeline = clientPage.getByRole('region', { name: 'Timeline' })
		await expect(clientTimeline.getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
		await waitForReadyTransfer(clientPage, 'remote')
		const clientRenderer = clientPage.getByRole('region', { name: 'Renderer stage' })
		await expect(clientRenderer.locator('video[data-resource-name="fixture-video.webm"]')).toHaveCount(1)
		await expect.poll(async () => {
			return clientRenderer.locator('video[data-resource-name="fixture-video.webm"]').evaluate((video) => {
				const element = video as HTMLVideoElement
				return element.readyState >= element.HAVE_CURRENT_DATA && element.videoWidth > 0 && element.videoHeight > 0
			})
		}, {
			timeout: 20_000,
		}).toBe(true)
	} finally {
		await closePeerHandles(first, second)
	}
})

test('p2p media imported from either peer is available on the other peer', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-bidirectional-media', test.info())
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 100,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	try {
		await waitForRolePair(first.page, second.page)
		const serverPage = await getRole(first.page) === 'server' ? first.page : second.page
		const clientPage = serverPage === first.page ? second.page : first.page
		const serverVideo = await createRenamedFixtureVideo('server-video.webm')
		const clientVideo = await createRenamedFixtureVideo('client-video.webm')

		await serverPage.getByLabel('Import media files').setInputFiles(serverVideo)
		await clientPage.getByLabel('Import media files').setInputFiles(clientVideo)

		await expect(clientPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'server-video.webm' })).toBeVisible()
		await expect(serverPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'client-video.webm' })).toBeVisible()
		await expect.poll(async () => {
			const serverTransfers = await windowTransfers(serverPage)
			const clientTransfers = await windowTransfers(clientPage)
			return {
				serverRemoteReady: serverTransfers.some((transfer) => transfer.name === 'client-video.webm' && transfer.availability === 'remote' && transfer.status === 'ready'),
				clientRemoteReady: clientTransfers.some((transfer) => transfer.name === 'server-video.webm' && transfer.availability === 'remote' && transfer.status === 'ready'),
			}
		}, {
			timeout: 20_000,
		}).toEqual({
			serverRemoteReady: true,
			clientRemoteReady: true,
		})
	} finally {
		await closePeerHandles(first, second)
	}
})

test('p2p peers keep independent active projects while remote preview stays available', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-independent-active-project', test.info())
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 100,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const videoFile = await createRenamedFixtureVideo('old-project-video.webm')

	try {
		await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await first.page.getByLabel('Import media files').setInputFiles(videoFile)
		const firstRow = first.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'old-project-video.webm' })
		await expect(firstRow).toBeVisible()
		await firstRow.getByRole('button', { name: 'Add to timeline' }).click()
		const oldProjectId = await getActiveProjectNodeId(first.page)

		const second = await openP2PPeer(browser, roomUrl)
		try {
			await waitForRolePair(first.page, second.page)
			await setActiveProject(second.page, oldProjectId)
			await expect(second.page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /old-project-video\.webm/i }).first()).toBeVisible()
			await waitForReadyTransfer(second.page, 'remote')
			const secondRenderer = second.page.getByRole('region', { name: 'Renderer stage' })
			await expect(secondRenderer.locator('video[data-resource-name="old-project-video.webm"]')).toHaveCount(1)

			await createProject(first.page, 'Project 2')
			const newProjectId = await getActiveProjectNodeId(first.page)
			expect(newProjectId).not.toBe(oldProjectId)
			await expect.poll(() => getActiveProjectNodeId(second.page), {
				timeout: 20_000,
			}).toBe(oldProjectId)
			await expect(second.page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /old-project-video\.webm/i }).first()).toBeVisible()
			await expect(secondRenderer.locator('video[data-resource-name="old-project-video.webm"]')).toHaveCount(1)

			await setActiveProject(second.page, newProjectId)
			await expect.poll(() => getActiveProjectNodeId(second.page), {
				timeout: 20_000,
			}).toBe(newProjectId)
		} finally {
			await closePeerHandles(second)
		}
	} finally {
		await closePeerHandles(first)
	}
})

const windowTransfers = async (page: import('@playwright/test').Page) =>
	page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getResourceTransfers?.() ?? []) as Promise<Array<{
		name: string
		availability: 'local' | 'remote'
		status: 'missing' | 'requesting' | 'partial' | 'ready' | 'error'
	}>>
