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
		trackRole?: unknown
		clips?: Array<{
			clipId?: unknown
			nodeId?: unknown
			id?: unknown
			name?: unknown
			resourceName?: unknown
			mediaKind?: unknown
			start?: unknown
			in?: unknown
			duration?: unknown
			fadeIn?: unknown
			fadeOut?: unknown
		}>
	}>
}

type DebugReviewState = {
	activeProject?: {
		attrs?: Record<string, unknown>
	}
	activeProjectReviewItems?: Array<{ nodeId?: unknown; attrs?: Record<string, unknown> }>
	activeProjectReviewSessions?: Array<{ nodeId?: unknown; attrs?: Record<string, unknown> }>
}

type ClipTimingPreview = {
	current?: ClipTimingSnapshot
	incoming?: ClipTimingSnapshot
}

type ClipTimingSnapshot = {
	start?: unknown
	in?: unknown
	duration?: unknown
	fadeIn?: unknown
	fadeOut?: unknown
}

const timingFieldNames = ['start', 'in', 'duration', 'fadeIn', 'fadeOut'] as const

type TimingFieldName = typeof timingFieldNames[number]

const asExpectedTiming = (value: ClipTimingSnapshot | undefined, label: string): Record<TimingFieldName, number> => {
	const result = Object.fromEntries(timingFieldNames.map((field) => [field, value?.[field]])) as Record<TimingFieldName, unknown>
	for (const field of timingFieldNames) {
		if (typeof result[field] !== 'number' || !Number.isFinite(result[field])) {
			throw new Error(`Expected numeric ${label}.${field}, got ${JSON.stringify(value)}`)
		}
	}
	return result as Record<TimingFieldName, number>
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

const readReviewDebugState = async (page: Page): Promise<DebugReviewState | null> =>
	page.evaluate(() => (window.__MINICUT_P2P_DEBUG__?.getReviewDebugState?.() ?? null) as DebugReviewState | null)

const readRuntimeMessages = async (page: Page): Promise<Array<Record<string, unknown>>> =>
	page.evaluate(() => (window.__MINICUT_P2P_DEBUG__?.getRuntimeMessages?.() ?? []) as Array<Record<string, unknown>>)

const countDispatchMessages = (
	messages: Array<Record<string, unknown>>,
	actionName: string,
): number =>
	messages.filter((entry) => {
		const message = entry.message as Record<string, unknown> | undefined
		return message?.type === 'dkt:dispatch-action' && message.actionName === actionName
	}).length

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

const readReviewOpenCount = async (page: Page): Promise<number | null> => {
	const state = await readReviewDebugState(page)
	const count =
		state?.activeProjectReviewSessions?.find((session) => typeof session.attrs?.openItemCount === 'number')
			?.attrs?.openItemCount ?? state?.activeProject?.attrs?.reviewOpenItemCount
	return typeof count === 'number' && Number.isFinite(count) ? count : null
}

const waitForReviewOpenCount = async (page: Page, expected: number) => {
	await expect.poll(() => readReviewOpenCount(page), { timeout: 30_000 }).toBe(expected)
}

const readReviewItemByConflict = async (page: Page, conflictId: string) => {
	const state = await readReviewDebugState(page)
	return state?.activeProjectReviewItems?.find((item) => item.attrs?.conflictId === conflictId) ?? null
}

const readFirstClipTimingReviewItem = async (page: Page) => {
	const state = await readReviewDebugState(page)
	const item = state?.activeProjectReviewItems?.find((entry) => entry.attrs?.kind === 'clip_timing') ?? null
	if (!item) {
		throw new Error(`Expected clip timing review item, got ${JSON.stringify(state?.activeProjectReviewItems ?? [])}`)
	}
	return item
}

const waitForReviewItemStatus = async (page: Page, conflictId: string, status: string) => {
	await expect.poll(async () => {
		const item = await readReviewItemByConflict(page, conflictId)
		return item?.attrs?.status ?? null
	}, { timeout: 30_000 }).toBe(status)
}

const waitForReviewResolvedOnBoth = async (firstPage: Page, secondPage: Page, conflictId: string) => {
	await Promise.all([
		waitForReviewItemStatus(firstPage, conflictId, 'resolved'),
		waitForReviewItemStatus(secondPage, conflictId, 'resolved'),
	])
}

const waitForReviewOpenCountOnBoth = async (firstPage: Page, secondPage: Page, expected: number) => {
	await Promise.all([
		waitForReviewOpenCount(firstPage, expected),
		waitForReviewOpenCount(secondPage, expected),
	])
}

const waitForIncomingReviewTrackWithClip = async (page: Page, expectedTiming?: Record<TimingFieldName, number>) => {
	const expected = expectedTiming
		? { hasTrack: true, clipCount: 1, timing: expectedTiming }
		: { hasTrack: true, clipCount: 1 }
	await expect.poll(async () => {
		const details = await readActiveProjectDetails(page)
		const reviewTrack = details?.tracks?.find((track) => track.trackRole === 'incomingReview')
		const clip = reviewTrack?.clips?.[0]
		const result: { hasTrack: boolean; clipCount: number; timing?: Record<TimingFieldName, unknown> } = {
			hasTrack: Boolean(reviewTrack),
			clipCount: reviewTrack?.clips?.length ?? 0,
		}
		if (expectedTiming) {
			result.timing = {
				start: clip?.start ?? null,
				in: clip?.in ?? null,
				duration: clip?.duration ?? null,
				fadeIn: clip?.fadeIn ?? null,
				fadeOut: clip?.fadeOut ?? null,
			}
		}
		return result
	}, { timeout: 30_000 }).toEqual(expected)
}

const readFirstClipTimingPreview = async (page: Page): Promise<ClipTimingPreview> => {
	const item = await readFirstClipTimingReviewItem(page)
	const preview = item.attrs?.preview
	if (!preview || typeof preview !== 'object') {
		throw new Error(`Expected clip timing preview, got ${JSON.stringify(item)}`)
	}
	return preview as ClipTimingPreview
}

const readClipDuration = async (page: Page, clipId: string): Promise<number | null> => {
	const details = await readActiveProjectDetails(page)
	const clip = details?.tracks
		?.flatMap((track) => track.clips ?? [])
		.find((candidate) => candidate.clipId === clipId || candidate.nodeId === clipId || candidate.id === clipId)
	const duration = clip?.duration
	return typeof duration === 'number' && Number.isFinite(duration) ? duration : null
}

const readClipTiming = async (page: Page, clipId: string): Promise<Record<TimingFieldName, unknown> | null> => {
	const details = await readActiveProjectDetails(page)
	const clip = details?.tracks
		?.flatMap((track) => track.clips ?? [])
		.find((candidate) => candidate.clipId === clipId || candidate.nodeId === clipId || candidate.id === clipId)
	return clip
		? {
			start: clip.start ?? null,
			in: clip.in ?? null,
			duration: clip.duration ?? null,
			fadeIn: clip.fadeIn ?? null,
			fadeOut: clip.fadeOut ?? null,
		}
		: null
}

const waitForClipTimingOnBoth = async (
	firstPage: Page,
	secondPage: Page,
	clipId: string,
	expectedTiming: Record<TimingFieldName, number>,
) => {
	await expect.poll(async () => ({
		first: await readClipTiming(firstPage, clipId),
		second: await readClipTiming(secondPage, clipId),
	}), { timeout: 30_000 }).toEqual({
		first: expectedTiming,
		second: expectedTiming,
	})
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

const dragClipEdgeByUi = async (page: Page, clipId: string, edge: 'start' | 'end', deltaPx: number) => {
	const before = await readClipDuration(page, clipId)
	if (before === null) {
		throw new Error(`Expected clip ${clipId} duration before UI trim`)
	}
	const clip = page
		.getByRole('region', { name: 'Timeline', exact: true })
		.locator('.ve-clip')
		.filter({ hasText: 'fixture-video.webm' })
		.first()
	await expect(clip).toBeVisible({ timeout: 10_000 })
	const handle = clip.locator(`.ve-clip__resize-handle--${edge}`)
	const box = await handle.boundingBox()
	if (!box) {
		throw new Error(`Expected visible clip ${edge} resize handle`)
	}
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + deltaPx, y, { steps: 6 })
	await page.mouse.up()
	await waitForRuntimeSettled(page)
	await expect.poll(() => readClipDuration(page, clipId), {
		timeout: 10_000,
	}).not.toBe(before)
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
			dragClipEdgeByUi(first.page, firstClipId, 'end', -28),
			dragClipEdgeByUi(second.page, firstClipId, 'start', 28),
		])
		await Promise.all([waitForRuntimeSettled(first.page), waitForRuntimeSettled(second.page)])
		await Promise.all([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])

		const reviewButtonName = /Review\s+[1-9]\d*/
		await expect(first.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await expect(second.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await first.page.getByRole('button', { name: reviewButtonName }).click()
		const projectReview = first.page.getByRole('region', { name: 'Project review' })
		await expect(projectReview).toBeVisible({ timeout: 10_000 })
		await expect(projectReview.getByText(/clip timing/i).first()).toBeVisible({ timeout: 30_000 })
		await expect(first.page.locator('.ve-clip-conflict-popover')).toHaveCount(0)
		await expectRealConflictTrace(first.page, second.page)
		await waitForRuntimeSettled(first.page)

		const openCountBefore = await readReviewOpenCount(first.page)
		expect(openCountBefore).toEqual(expect.any(Number))
		const dispatchCountBefore = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'parkIncomingVariantOnReviewTrack',
		)
		const parkPreview = await readFirstClipTimingPreview(first.page)
		const expectedParkedTiming = asExpectedTiming(parkPreview.incoming, 'incoming')
		const conflictId = stringId((await readFirstClipTimingReviewItem(first.page)).attrs?.conflictId, 'conflict id')
		const actionSendBatchIdsBefore = await readTraceBatchIds(first.page, /crdt-send/)
		await projectReview.getByRole('button', { name: 'Park incoming on review track' }).click()
		await waitForRuntimeSettled(first.page)
		const dispatchCountAfter = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'parkIncomingVariantOnReviewTrack',
		)
		if (dispatchCountAfter <= dispatchCountBefore) {
			const buttonDiagnostics = await first.page.evaluate(() => {
				const buttons = [...document.querySelectorAll('button')]
				const button = buttons.find((candidate) => candidate.textContent?.includes('Park incoming on review track')) as HTMLButtonElement | undefined
				if (!button) return { found: false }
				const box = button.getBoundingClientRect()
				const reactPropsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'))
				const props = reactPropsKey ? (button as unknown as Record<string, Record<string, unknown>>)[reactPropsKey] : null
				const eventLog: string[] = []
				const log = (event: Event) => eventLog.push(`${event.type}:${event.eventPhase}:${event.currentTarget === button ? 'button' : 'document'}`)
				document.addEventListener('click', log, true)
				button.addEventListener('click', log, true)
				button.addEventListener('click', log)
				document.addEventListener('click', log)
				button.click()
				if (typeof props?.onClick === 'function') {
					;(props.onClick as (event: unknown) => void)({
						currentTarget: button,
						target: button,
						preventDefault() {},
						stopPropagation() {},
					})
				}
				document.removeEventListener('click', log, true)
				button.removeEventListener('click', log, true)
				button.removeEventListener('click', log)
				document.removeEventListener('click', log)
				const centerX = box.left + box.width / 2
				const centerY = box.top + box.height / 2
				const topElement = document.elementFromPoint(centerX, centerY)
				const style = getComputedStyle(button)
				return {
					found: true,
					disabled: button.disabled,
					pointerEvents: style.pointerEvents,
					visibility: style.visibility,
					display: style.display,
					topTag: topElement?.tagName ?? null,
					topText: topElement?.textContent ?? null,
					reactPropsKey,
					reactOnClickType: typeof props?.onClick,
					eventLog,
				}
			})
			await waitForRuntimeSettled(first.page)
			const dispatchCountAfterDirect = countDispatchMessages(
				await readRuntimeMessages(first.page),
				'parkIncomingVariantOnReviewTrack',
			)
			throw new Error(`Park incoming did not dispatch. Diagnostics: ${JSON.stringify({
				buttonDiagnostics,
				dispatchCountBefore,
				dispatchCountAfter,
				dispatchCountAfterDirect,
				reviewState: await readReviewDebugState(first.page),
			})}`)
		}
		const actionSendBatchIds = await waitForNewCrdtSendBatchIds(first.page, actionSendBatchIdsBefore)
		await waitForCrdtReceiveBatchIds(second.page, actionSendBatchIds)
		await waitForIncomingReviewTrackWithClip(first.page, expectedParkedTiming)
		await waitForIncomingReviewTrackWithClip(second.page, expectedParkedTiming)
		await waitForReviewResolvedOnBoth(first.page, second.page, conflictId)
		await waitForReviewOpenCountOnBoth(first.page, second.page, Math.max(0, (openCountBefore ?? 1) - 1))
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

test('p2p real CRDT timing conflict accepts incoming from review UI on both peers', async ({ browser }, testInfo) => {
	test.setTimeout(180_000)
	const roomId = createP2PRoomId('real-crdt-accept-incoming', testInfo)
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

		await sourcePage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.dispatchCreateProject?.('Real CRDT accept incoming'))
		await waitForRuntimeSettled(sourcePage)
		const sourceProject = await waitForActiveProject(sourcePage, 'Real CRDT accept incoming')
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
			dragClipEdgeByUi(first.page, firstClipId, 'end', -28),
			dragClipEdgeByUi(second.page, firstClipId, 'start', 28),
		])
		await Promise.all([waitForRuntimeSettled(first.page), waitForRuntimeSettled(second.page)])
		await Promise.all([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])

		const reviewButtonName = /Review\s+[1-9]\d*/
		await expect(first.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await expect(second.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await first.page.getByRole('button', { name: reviewButtonName }).click()
		const projectReview = first.page.getByRole('region', { name: 'Project review' })
		await expect(projectReview).toBeVisible({ timeout: 10_000 })
		await expect(projectReview.getByText(/clip timing/i).first()).toBeVisible({ timeout: 30_000 })
		await expectRealConflictTrace(first.page, second.page)
		await waitForRuntimeSettled(first.page)

		const openCountBefore = await readReviewOpenCount(first.page)
		expect(openCountBefore).toEqual(expect.any(Number))
		const dispatchCountBefore = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'resolveClipTimingConflict',
		)
		const actionSendBatchIdsBefore = await readTraceBatchIds(first.page, /crdt-send/)
		const preview = await readFirstClipTimingPreview(first.page)
		const expectedTiming = asExpectedTiming(preview.incoming, 'incoming')
		const conflictId = stringId((await readFirstClipTimingReviewItem(first.page)).attrs?.conflictId, 'conflict id')

		await projectReview.getByRole('button', { name: 'Choose incoming' }).click()
		await waitForRuntimeSettled(first.page)
		const dispatchCountAfter = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'resolveClipTimingConflict',
		)
		expect(dispatchCountAfter).toBeGreaterThan(dispatchCountBefore)
		const actionSendBatchIds = await waitForNewCrdtSendBatchIds(first.page, actionSendBatchIdsBefore)
		await waitForCrdtReceiveBatchIds(second.page, actionSendBatchIds)
		await waitForReviewResolvedOnBoth(first.page, second.page, conflictId)
		await waitForReviewOpenCountOnBoth(first.page, second.page, Math.max(0, (openCountBefore ?? 1) - 1))
		await waitForClipTimingOnBoth(first.page, second.page, firstClipId, expectedTiming)
		await expect.poll(async () => ({
			first: await readReviewOpenCount(first.page),
			second: await readReviewOpenCount(second.page),
		}), { timeout: 30_000 }).toEqual({
			first: Math.max(0, (openCountBefore ?? 1) - 1),
			second: Math.max(0, (openCountBefore ?? 1) - 1),
		})
	} catch (error) {
		const artifactPath = await writeP2PDebugArtifacts('real-crdt-accept-incoming-timeout', first.page, second.page)
		throw new Error(`Timed out waiting for real CRDT accept incoming proof. Debug artifact: ${artifactPath}`, { cause: error })
	} finally {
		await Promise.allSettled([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])
		await closePeerHandles(first, second)
	}
})

test('p2p real CRDT timing conflict keeps current from review UI on both peers', async ({ browser }, testInfo) => {
	test.setTimeout(180_000)
	const roomId = createP2PRoomId('real-crdt-choose-current', testInfo)
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

		await sourcePage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.dispatchCreateProject?.('Real CRDT choose current'))
		await waitForRuntimeSettled(sourcePage)
		const sourceProject = await waitForActiveProject(sourcePage, 'Real CRDT choose current')
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
			dragClipEdgeByUi(first.page, firstClipId, 'end', -28),
			dragClipEdgeByUi(second.page, firstClipId, 'start', 28),
		])
		await Promise.all([waitForRuntimeSettled(first.page), waitForRuntimeSettled(second.page)])
		await Promise.all([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])

		const reviewButtonName = /Review\s+[1-9]\d*/
		await expect(first.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await expect(second.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await first.page.getByRole('button', { name: reviewButtonName }).click()
		const projectReview = first.page.getByRole('region', { name: 'Project review' })
		await expect(projectReview).toBeVisible({ timeout: 10_000 })
		await expect(projectReview.getByText(/clip timing/i).first()).toBeVisible({ timeout: 30_000 })
		await waitForRuntimeSettled(first.page)

		const openCountBefore = await readReviewOpenCount(first.page)
		expect(openCountBefore).toEqual(expect.any(Number))
		const dispatchCountBefore = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'resolveClipTimingConflict',
		)
		const actionSendBatchIdsBefore = await readTraceBatchIds(first.page, /crdt-send/)
		const preview = await readFirstClipTimingPreview(first.page)
		const expectedTiming = asExpectedTiming(preview.current, 'current')
		const conflictId = stringId((await readFirstClipTimingReviewItem(first.page)).attrs?.conflictId, 'conflict id')

		await projectReview.getByRole('button', { name: 'Choose current' }).click()
		await waitForRuntimeSettled(first.page)
		const dispatchCountAfter = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'resolveClipTimingConflict',
		)
		expect(dispatchCountAfter).toBeGreaterThan(dispatchCountBefore)
		const actionSendBatchIds = await waitForNewCrdtSendBatchIds(first.page, actionSendBatchIdsBefore)
		await waitForCrdtReceiveBatchIds(second.page, actionSendBatchIds)
		await waitForReviewResolvedOnBoth(first.page, second.page, conflictId)
		await waitForReviewOpenCountOnBoth(first.page, second.page, Math.max(0, (openCountBefore ?? 1) - 1))
		await waitForClipTimingOnBoth(first.page, second.page, firstClipId, expectedTiming)
	} catch (error) {
		const artifactPath = await writeP2PDebugArtifacts('real-crdt-choose-current-timeout', first.page, second.page)
		throw new Error(`Timed out waiting for real CRDT choose current proof. Debug artifact: ${artifactPath}`, { cause: error })
	} finally {
		await Promise.allSettled([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])
		await closePeerHandles(first, second)
	}
})

test('p2p real CRDT timing conflict applies final timing from review UI on both peers', async ({ browser }, testInfo) => {
	test.setTimeout(180_000)
	const roomId = createP2PRoomId('real-crdt-apply-final', testInfo)
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

		await sourcePage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.dispatchCreateProject?.('Real CRDT apply final'))
		await waitForRuntimeSettled(sourcePage)
		const sourceProject = await waitForActiveProject(sourcePage, 'Real CRDT apply final')
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
			dragClipEdgeByUi(first.page, firstClipId, 'end', -28),
			dragClipEdgeByUi(second.page, firstClipId, 'start', 28),
		])
		await Promise.all([waitForRuntimeSettled(first.page), waitForRuntimeSettled(second.page)])
		await Promise.all([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])

		const reviewButtonName = /Review\s+[1-9]\d*/
		await expect(first.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await expect(second.page.getByRole('button', { name: reviewButtonName })).toBeVisible({ timeout: 30_000 })
		await first.page.getByRole('button', { name: reviewButtonName }).click()
		const projectReview = first.page.getByRole('region', { name: 'Project review' })
		await expect(projectReview).toBeVisible({ timeout: 10_000 })
		await expect(projectReview.getByText(/clip timing/i).first()).toBeVisible({ timeout: 30_000 })
		await waitForRuntimeSettled(first.page)

		const openCountBefore = await readReviewOpenCount(first.page)
		expect(openCountBefore).toEqual(expect.any(Number))
		const dispatchCountBefore = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'resolveClipTimingConflict',
		)
		const actionSendBatchIdsBefore = await readTraceBatchIds(first.page, /crdt-send/)
		const preview = await readFirstClipTimingPreview(first.page)
		const expectedTiming = {
			...asExpectedTiming(preview.current, 'current'),
			start: 0.25,
		}
		const conflictId = stringId((await readFirstClipTimingReviewItem(first.page)).attrs?.conflictId, 'conflict id')

		await projectReview.getByLabel('Final start').fill('0.25')
		await projectReview.getByRole('button', { name: 'Apply final timing' }).click()
		await waitForRuntimeSettled(first.page)
		const dispatchCountAfter = countDispatchMessages(
			await readRuntimeMessages(first.page),
			'resolveClipTimingConflict',
		)
		expect(dispatchCountAfter).toBeGreaterThan(dispatchCountBefore)
		const actionSendBatchIds = await waitForNewCrdtSendBatchIds(first.page, actionSendBatchIdsBefore)
		await waitForCrdtReceiveBatchIds(second.page, actionSendBatchIds)
		await waitForReviewResolvedOnBoth(first.page, second.page, conflictId)
		await waitForReviewOpenCountOnBoth(first.page, second.page, Math.max(0, (openCountBefore ?? 1) - 1))
		await waitForClipTimingOnBoth(first.page, second.page, firstClipId, expectedTiming)
	} catch (error) {
		const artifactPath = await writeP2PDebugArtifacts('real-crdt-apply-final-timeout', first.page, second.page)
		throw new Error(`Timed out waiting for real CRDT apply final proof. Debug artifact: ${artifactPath}`, { cause: error })
	} finally {
		await Promise.allSettled([
			setCrdtPartition(first.page, false),
			setCrdtPartition(second.page, false),
		])
		await closePeerHandles(first, second)
	}
})
