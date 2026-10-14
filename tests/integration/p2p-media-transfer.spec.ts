import { expect, test } from '@playwright/test'
import {
	buildRoomUrl,
	closePeerHandles,
	createFixtureVideo,
	createProject,
	createP2PRoomId,
	getActiveProjectNodeId,
	getRole,
	getTransfers,
	openP2PPeer,
	readActiveProjectNodeId,
	readP2PDebugState,
	selectSharedActiveProject,
	setActiveProject,
	waitForReadyTransfer,
	waitForRendererVideoReady,
	waitForRolePair,
	writeP2PDebugArtifactsMany,
} from './p2pTestHelpers'

const createRenamedFixtureVideo = async (name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> => {
	const fixture = await createFixtureVideo()
	return {
		...fixture,
		name,
	}
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

		await selectSharedActiveProject(serverPage, clientPage)
		await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
		const remoteRow = clientPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(remoteRow).toBeVisible()
		await remoteRow.getByRole('button', { name: 'Add to timeline' }).click()
		await expect(clientPage.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
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

		await selectSharedActiveProject(serverPage, clientPage)
		await serverPage.getByLabel('Import media files').setInputFiles(generatedVideo)
		const serverRow = serverPage.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		await expect(serverRow).toBeVisible()
		await serverRow.getByRole('button', { name: 'Add to timeline' }).click()

		const clientTimeline = clientPage.getByRole('region', { name: 'Timeline', exact: true })
		await expect(clientTimeline.getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible()
		await waitForReadyTransfer(clientPage, 'remote')
		const [ownerTransfers, remoteTransfers, ownerState] = await Promise.all([
			getTransfers(serverPage),
			getTransfers(clientPage),
			readP2PDebugState(serverPage),
		])
		const fixtureByteLength = generatedVideo.buffer.length
		expect(fixtureByteLength).toBeGreaterThan(512)
		const remoteMatches = remoteTransfers.filter((transfer) =>
			transfer.name === generatedVideo.name && transfer.availability === 'remote',
		)
		expect(remoteMatches).toHaveLength(1)
		const remoteTransfer = remoteMatches[0]!
		expect(remoteTransfer.resourceId).toEqual(expect.any(String))
		expect(remoteTransfer.resourceId).not.toBe('')
		expect(remoteTransfer.totalBytes).toBe(fixtureByteLength)
		expect(remoteTransfer.loadedBytes).toBe(fixtureByteLength)
		expect(remoteTransfer.loadedRanges).toEqual([[0, fixtureByteLength]])
		expect(remoteTransfer.lastError).toBeNull()

		const ownerMatches = ownerTransfers.filter((transfer) =>
			transfer.resourceId === remoteTransfer.resourceId && transfer.availability === 'local',
		)
		expect(ownerMatches).toHaveLength(1)
		const ownerTransfer = ownerMatches[0]!
		expect(ownerTransfer.name).toBe(generatedVideo.name)
		expect(ownerTransfer.status).toBe('ready')
		expect(ownerTransfer.totalBytes).toBe(fixtureByteLength)
		expect(ownerTransfer.lastError).toBeNull()
		expect(ownerState?.peerId).toEqual(expect.any(String))
		expect(ownerState?.peerId).not.toBe('')
		expect(ownerTransfer.ownerPeerId).toBe(ownerState?.peerId)
		expect(remoteTransfer.ownerPeerId).toBe(ownerState?.peerId)

		expect(remoteTransfer.previewUrl).toMatch(/^blob:/)
		const receivedBytes = await clientPage.evaluate(async (previewUrl) => {
			const response = await fetch(previewUrl)
			if (!response.ok) throw new Error(`Could not read received media blob: ${response.status}`)
			return Array.from(new Uint8Array(await response.arrayBuffer()))
		}, remoteTransfer.previewUrl)
		const receivedBuffer = Buffer.from(receivedBytes)
		expect(receivedBuffer).toEqual(generatedVideo.buffer)
		expect(receivedBuffer.subarray(0, 512)).toEqual(generatedVideo.buffer.subarray(0, 512))
		try {
			await waitForRendererVideoReady(clientPage, 'fixture-video.webm')
		} catch (error) {
			const artifactPath = await writeP2PDebugArtifactsMany('main-timeline-preview-missing-video', [
				{ label: 'server', page: serverPage },
				{ label: 'client', page: clientPage },
			])
			throw new Error(`Timed out waiting for remote renderer video. Debug artifact: ${artifactPath}`, { cause: error })
		}
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

		await selectSharedActiveProject(serverPage, clientPage)
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
			await expect(second.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /old-project-video\.webm/i }).first()).toBeVisible()
			await waitForReadyTransfer(second.page, 'remote')
			const secondRenderer = second.page.getByRole('region', { name: 'Renderer stage' })
			await expect(secondRenderer.locator('video[data-resource-name="old-project-video.webm"]')).toHaveCount(1)

			await createProject(first.page, 'Project 2')
			const newProjectId = await getActiveProjectNodeId(first.page)
			expect(newProjectId).not.toBe(oldProjectId)
			await expect.poll(() => getActiveProjectNodeId(second.page), {
				timeout: 20_000,
			}).toBe(oldProjectId)
			await expect(second.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /old-project-video\.webm/i }).first()).toBeVisible()
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

test('late p2p peer renders remote preview after selecting the shared project', async ({ browser }) => {
	const roomId = createP2PRoomId('p2p-late-peer-active-project', test.info())
	const roomUrl = buildRoomUrl(roomId, {
		transferChunkSize: 512,
		transferChunkDelayMs: 100,
		transferHeadBytes: 512,
		transferPlayheadWindowSeconds: 0.5,
	})
	const first = await openP2PPeer(browser, roomUrl)
	const videoFile = await createRenamedFixtureVideo('late-peer-video.webm')

	try {
		await expect(first.page.getByRole('heading', { name: 'minicut' })).toBeVisible()
		await first.page.getByLabel('Import media files').setInputFiles(videoFile)
		const firstRow = first.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'late-peer-video.webm' })
		await expect(firstRow).toBeVisible()
		await firstRow.getByRole('button', { name: 'Add to timeline' }).click()
		const projectId = await getActiveProjectNodeId(first.page)

		const second = await openP2PPeer(browser, roomUrl)
		try {
			await waitForRolePair(first.page, second.page)
			await setActiveProject(second.page, projectId)
			await expect.poll(() => readActiveProjectNodeId(second.page), {
				timeout: 20_000,
			}).toBe(projectId)

			const secondTimeline = second.page.getByRole('region', { name: 'Timeline', exact: true })
			await expect(secondTimeline.getByRole('button', { name: /late-peer-video\.webm/i }).first()).toBeVisible()
			await waitForReadyTransfer(second.page, 'remote')
			const secondRow = second.page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'late-peer-video.webm' })
			await expect(secondRow).toBeVisible()
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
