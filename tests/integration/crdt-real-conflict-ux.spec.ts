import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import {
	buildRoomUrl,
	closePeerHandles,
	createP2PRoomId,
	getRole,
	openP2PPeer,
	readP2PTrace,
	waitForP2PDebugState,
	waitForRolePair,
	waitForRuntimeSettled,
	writeP2PDebugArtifacts,
} from './p2pTestHelpers'

type DebugProjectDetails = {
	projectId?: unknown
	title?: unknown
	resources?: Array<{ resourceId?: unknown; nodeId?: unknown; name?: unknown; kind?: unknown }>
	tracks?: Array<{
		kind?: unknown
		clips?: Array<{ clipId?: unknown; nodeId?: unknown; id?: unknown; name?: unknown; resourceName?: unknown; mediaKind?: unknown }>
	}>
}

const importFixtureVideoToTimeline = async (page: Page) => {
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	const resourceRow = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	await expect(resourceRow).toBeVisible({ timeout: 20_000 })
	await resourceRow.getByRole('button', { name: 'Add to timeline' }).click()
	await expect(page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()).toBeVisible({ timeout: 20_000 })
}

const readActiveProjectDetails = async (page: Page): Promise<DebugProjectDetails | null> =>
	page.evaluate(() => (window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() ?? null) as DebugProjectDetails | null)

const waitForActiveProject = async (page: Page, title: string): Promise<DebugProjectDetails> => {
	let latest: DebugProjectDetails | null = null
	await expect.poll(async () => page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()), {
		timeout: 30_000,
	}).toMatchObject({ title })
	latest = await readActiveProjectDetails(page)
	if (!latest) {
		throw new Error(`Expected active project ${title}`)
	}
	return latest
}

const expectSourceProjectHasVideoClip = async (page: Page, clipId: string) => {
	await expect.poll(async () => {
		const details = await readActiveProjectDetails(page)
		return {
			hasResource: details?.resources?.some((resource) => resource.name === 'fixture-video.webm' && resource.kind === 'video') ?? false,
			hasClip: details?.tracks?.some((track) =>
				track.kind === 'video' &&
				track.clips?.some((clip) => (clip.clipId === clipId || clip.nodeId === clipId) && clip.mediaKind === 'video'),
			) ?? false,
		}
	}, { timeout: 20_000 }).toEqual({ hasResource: true, hasClip: true })
}

const stringId = (value: unknown, label: string): string => {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Expected ${label}`)
	}
	return value
}

const waitForFirstVideoClipId = async (page: Page): Promise<string> => {
	let clipId: string | null = null
	await expect.poll(async () => {
		clipId = await readFirstVideoClipId(page)
		return clipId
	}, { timeout: 30_000 }).toEqual(expect.any(String))
	if (!clipId) {
		throw new Error('Expected first video clip id')
	}
	return clipId
}

const readFirstVideoClipId = async (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		const details = window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() as DebugProjectDetails | null
		const clip = details?.tracks
			?.flatMap((track) => track.clips ?? [])
			.find((candidate) =>
				candidate.mediaKind === 'video' ||
				candidate.name === 'fixture-video.webm' ||
				candidate.resourceName === 'fixture-video.webm',
			)
		const id = clip?.clipId ?? clip?.nodeId ?? clip?.id
		return typeof id === 'string' && id.length > 0 ? id : null
	})

const readTraceBatchIds = async (page: Page, eventPattern: RegExp): Promise<string[]> => {
	const trace = await readP2PTrace(page) as Array<Record<string, unknown>>
	return [...new Set(trace.flatMap((entry) => {
		if (typeof entry.event !== 'string' || !eventPattern.test(entry.event)) {
			return []
		}
		return Array.isArray(entry.batchIds)
			? entry.batchIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
			: []
	}))]
}

const waitForNewCrdtSendBatchIds = async (page: Page, beforeIds: string[]): Promise<string[]> => {
	let newIds: string[] = []
	await expect.poll(async () => {
		const currentIds = await readTraceBatchIds(page, /crdt-send/)
		newIds = currentIds.filter((id) => !beforeIds.includes(id))
		return newIds.length
	}, { timeout: 30_000 }).toBeGreaterThan(0)
	return newIds
}

const waitForCrdtReceiveBatchIds = async (page: Page, batchIds: string[]) => {
	await expect.poll(async () => {
		const receivedIds = await readTraceBatchIds(page, /crdt.*receive/)
		return batchIds.every((id) => receivedIds.includes(id))
	}, { timeout: 30_000 }).toBe(true)
}

const selectActiveProject = async (page: Page, projectId: string): Promise<DebugProjectDetails | null> =>
	page.evaluate(async (nextProjectId) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.setActiveProject) {
			throw new Error('setActiveProject debug helper is unavailable')
		}
		await debug.setActiveProject(nextProjectId)
		return (debug.getActiveProjectDetails?.() ?? null) as DebugProjectDetails | null
	}, projectId)

const waitForReplicaProject = async (page: Page, projectId: string) => {
	await expect.poll(async () => {
		try {
			const details = await selectActiveProject(page, projectId)
			return details?.projectId ?? null
		} catch {
			return null
		}
	}, { timeout: 30_000 }).toBe(projectId)
}

const waitForClipOnActiveProject = async (page: Page, clipId: string) => {
	await expect.poll(async () => {
		const details = await readActiveProjectDetails(page)
		return details?.tracks?.some((track) =>
			track.clips?.some((clip) => clip.clipId === clipId || clip.nodeId === clipId || clip.id === clipId),
		) ?? false
	}, { timeout: 30_000 }).toBe(true)
}

const waitForWorkerDumpContainsProjectResourceAndClip = async (page: Page, projectId: string, clipId: string) => {
	let latest: unknown = null
	await expect.poll(async () => {
		latest = await page.evaluate(async ({ expectedProjectId, expectedClipId }) => {
			const dump = await Promise.race([
				window.__MINICUT_P2P_DEBUG__?.dumpWorkerState?.(),
				new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 10_000)),
			]) as {
				timedOut?: boolean
				runtimeModels?: Array<{ nodeId?: unknown; modelName?: unknown; attrs?: Record<string, unknown> }>
			} | null
			const models = dump?.runtimeModels ?? []
			return {
				timedOut: dump?.timedOut === true,
				hasProject: models.some((model) => model.nodeId === expectedProjectId),
				hasClip: models.some((model) => model.nodeId === expectedClipId),
				hasResource: models.some((model) => model.modelName === 'resource' && model.attrs?.name === 'fixture-video.webm'),
				modelCount: models.length,
				modelNames: [...new Set(models.map((model) => model.modelName).filter(Boolean))],
			}
		}, { expectedProjectId: projectId, expectedClipId: clipId })
		return latest
	}, {
		timeout: 45_000,
		intervals: [10_000, 10_000, 10_000, 10_000],
		message: () => `Latest replica worker dump check: ${JSON.stringify(latest)}`,
	}).toMatchObject({
		timedOut: false,
		hasProject: true,
		hasClip: true,
		hasResource: true,
	})
}

const setCrdtPartition = async (page: Page, enabled: boolean) => {
	await page.evaluate((nextEnabled) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.setCrdtNetworkPartitionTesting) {
			throw new Error('CRDT partition control is unavailable')
		}
		const result = debug.setCrdtNetworkPartitionTesting(nextEnabled)
		if (result.enabled !== nextEnabled) {
			throw new Error(`CRDT partition expected ${nextEnabled}, got ${result.enabled}`)
		}
	}, enabled)
}

const dispatchClipTrim = async (page: Page, clipId: string, delta: number) => {
	await page.evaluate(async ({ targetClipId, trimDelta }) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.dispatchClipActionById) {
			throw new Error('Clip action dispatcher is unavailable')
		}
		await debug.dispatchClipActionById(targetClipId, 'trim', { edge: 'end', delta: trimDelta })
	}, { targetClipId: clipId, trimDelta: delta })
}

const expectRealConflictTrace = async (firstPage: Page, secondPage: Page) => {
	const [firstTrace, secondTrace] = await Promise.all([
		readP2PTrace(firstPage),
		readP2PTrace(secondPage),
	])
	const combinedTrace = [...firstTrace, ...secondTrace] as Array<Record<string, unknown>>
	expect(combinedTrace).toEqual(expect.arrayContaining([
		expect.objectContaining({ event: 'authority:crdt-partition', enabled: true }),
		expect.objectContaining({ event: 'authority:crdt-partition', enabled: false }),
		expect.objectContaining({ event: 'authority:crdt-send-partitioned' }),
		expect.objectContaining({ event: expect.stringMatching(/crdt-(send|receive)/) }),
	]))
	expect(combinedTrace).not.toEqual(expect.arrayContaining([
		expect.objectContaining({ event: expect.stringMatching(/fake|inject/i) }),
	]))
}

test('p2p real CRDT timing conflict renders conflict UX without fake injection', async ({ browser }, testInfo) => {
	test.setTimeout(180_000)
	const roomId = createP2PRoomId('real-crdt-conflict', testInfo)
	const roomUrl = buildRoomUrl(roomId)
	const first = await openP2PPeer(browser, roomUrl)
	const second = await openP2PPeer(browser, roomUrl)

	try {
		await Promise.all([waitForP2PDebugState(first.page), waitForP2PDebugState(second.page)])
		await waitForRolePair(first.page, second.page)
		const [firstRole] = await Promise.all([getRole(first.page), getRole(second.page)])
		const sourcePage = firstRole === 'client' ? first.page : second.page
		const replicaPage = sourcePage === first.page ? second.page : first.page
		const sourceSendBatchIdsBefore = await readTraceBatchIds(sourcePage, /crdt-send/)

		await sourcePage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.dispatchCreateProject?.('Real CRDT conflict'))
		await waitForRuntimeSettled(sourcePage)
		const sourceProject = await waitForActiveProject(sourcePage, 'Real CRDT conflict')
		const sourceProjectId = stringId(sourceProject.projectId, 'source project id')
		await importFixtureVideoToTimeline(sourcePage)
		await waitForRuntimeSettled(sourcePage)

		const firstClipId = await waitForFirstVideoClipId(sourcePage)
		await expectSourceProjectHasVideoClip(sourcePage, firstClipId)
		const sourceSendBatchIds = await waitForNewCrdtSendBatchIds(sourcePage, sourceSendBatchIdsBefore)
		await waitForCrdtReceiveBatchIds(replicaPage, sourceSendBatchIds)
		await waitForWorkerDumpContainsProjectResourceAndClip(replicaPage, sourceProjectId, firstClipId)
		await waitForReplicaProject(replicaPage, sourceProjectId)
		await waitForClipOnActiveProject(replicaPage, firstClipId)

		await Promise.all([
			setCrdtPartition(first.page, true),
			setCrdtPartition(second.page, true),
		])
		await Promise.all([
			dispatchClipTrim(first.page, firstClipId, -0.1),
			dispatchClipTrim(second.page, firstClipId, -0.2),
		])
		await Promise.all([waitForRuntimeSettled(first.page), waitForRuntimeSettled(second.page)])
		await Promise.all([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])

		await expect(first.page.locator('.clip-conflict-badge').first()).toBeVisible({ timeout: 30_000 })
		await expect(second.page.locator('.clip-conflict-badge').first()).toBeVisible({ timeout: 30_000 })
		await expectRealConflictTrace(first.page, second.page)
	} catch (error) {
		const artifactPath = await writeP2PDebugArtifacts('real-crdt-conflict-timeout', first.page, second.page)
		throw new Error(`Timed out waiting for real CRDT conflict proof. Debug artifact: ${artifactPath}`, { cause: error })
	} finally {
		await Promise.allSettled([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])
		await closePeerHandles(first, second)
	}
})
