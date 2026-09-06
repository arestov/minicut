import { chromium, expect, test, type Locator, type Page } from '@playwright/test'

const installOpfsPicker = async (page: Page) => {
	await page.addInitScript(async () => {
		;(window as Window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ = true
		const root = await navigator.storage.getDirectory()
		const handle = await root.getFileHandle('picked-handle-video.webm', { create: true })
		const writable = await handle.createWritable()
		const videoBytes = await (await fetch('/tests/fixtures/media/fixture-video.webm')).blob()
		await writable.write(videoBytes)
		await writable.close()
		const readVideoFile = handle.getFile.bind(handle)
		Object.defineProperty(handle, 'getFile', { value: async () => new File([await (await readVideoFile()).arrayBuffer()], 'picked-handle-video.webm', { type: 'video/webm' }), configurable: true })
		const incompatibleHandle = await root.getFileHandle('picked-incompatible.wav', { create: true })
		const incompatibleWritable = await incompatibleHandle.createWritable()
		await incompatibleWritable.write(await (await fetch('/tests/fixtures/media/fixture-audio.wav')).blob())
		await incompatibleWritable.close()
		const readIncompatibleFile = incompatibleHandle.getFile.bind(incompatibleHandle)
		Object.defineProperty(incompatibleHandle, 'getFile', { value: async () => new File([await (await readIncompatibleFile()).arrayBuffer()], 'picked-incompatible.wav', { type: 'audio/wav' }), configurable: true })
		const handlePrototype = Object.getPrototypeOf(handle) as object
		Object.defineProperty(handlePrototype, 'queryPermission', {
			value: async () => {
				const stats = JSON.parse(localStorage.getItem('minicut-permission-stats') ?? '{"queries":0,"requests":0}') as { queries: number; requests: number }
				stats.queries += 1; localStorage.setItem('minicut-permission-stats', JSON.stringify(stats))
				return (localStorage.getItem('minicut-permission-state') ?? 'granted') as PermissionState
			}, configurable: true,
		})
		Object.defineProperty(handlePrototype, 'requestPermission', {
			value: async () => {
				const stats = JSON.parse(localStorage.getItem('minicut-permission-stats') ?? '{"queries":0,"requests":0}') as { queries: number; requests: number }
				stats.requests += 1; localStorage.setItem('minicut-permission-stats', JSON.stringify(stats))
				const next = localStorage.getItem('minicut-permission-next') ?? 'denied'; localStorage.setItem('minicut-permission-state', next)
				return next as PermissionState
			}, configurable: true,
		})
		Object.defineProperty(window, 'showOpenFilePicker', {
			value: async () => [localStorage.getItem('minicut-picker-mode') === 'incompatible' ? incompatibleHandle : handle],
			configurable: true,
		})
	})
}

const setTimelineCursor = async (page: Page, seconds: number): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const laneBox = await laneScroll.boundingBox()
	if (!laneBox) throw new Error('Timeline lane scroll area is unavailable')
	await laneScroll.click({ position: { x: Math.max(8, seconds * zoom), y: Math.max(12, laneBox.height - 12) } })
}

type RecoverySnapshot = {
	projectId: string
	resourceId: string
	assetRef: string
	url: string
	taskId: string
	operationId: string
	phase: string
}

const readRecoverySnapshot = async (page: Page): Promise<RecoverySnapshot | null> => page.evaluate(async () => {
	const details = window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() as { projectId?: unknown; resources?: Array<{ resourceId?: unknown; assetRef?: unknown; url?: unknown; activeMediaRecoveryTask?: { nodeId?: unknown; operationId?: unknown; phase?: unknown } | null }> } | undefined
	const resource = details?.resources?.[0]
	const task = resource?.activeMediaRecoveryTask
	if (typeof details?.projectId !== 'string' || typeof resource?.resourceId !== 'string' || typeof resource.url !== 'string' || !resource.url.startsWith('blob:') || typeof task?.nodeId !== 'string' || typeof task.operationId !== 'string' || task.phase !== 'completed') return null
	let assetRef = typeof resource.assetRef === 'string' ? resource.assetRef : ''
	if (!assetRef) {
		try {
			const root = await navigator.storage.getDirectory()
			const manifest = await (await (await (await (await root.getDirectoryHandle('projects')).getDirectoryHandle(details.projectId)).getDirectoryHandle('assets')).getDirectoryHandle(resource.resourceId)).getFileHandle('manifest.json')
			assetRef = String((JSON.parse(await (await manifest.getFile()).text()) as { assetRef?: unknown }).assetRef ?? '')
		} catch { return null }
	}
	return assetRef ? { projectId: details.projectId, resourceId: resource.resourceId, assetRef, url: resource.url, taskId: task.nodeId, operationId: task.operationId, phase: task.phase } : null
})

const waitForCompletedRecovery = async (page: Page, previous?: RecoverySnapshot): Promise<RecoverySnapshot> => {
	await expect.poll(async () => {
		const current = await readRecoverySnapshot(page)
		return current && (!previous || (current.taskId !== previous.taskId && current.operationId !== previous.operationId)) ? current : null
	}, { timeout: 20_000 }).not.toBeNull()
	const snapshot = await readRecoverySnapshot(page)
	if (!snapshot) throw new Error('Completed recovery snapshot is unavailable')
	return snapshot
}

const confirmReplacementIfNeeded = async (page: Page, row: Locator, previousTaskId?: string): Promise<void> => {
	await expect.poll(async () => {
		const task = (await page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()) as { resources?: Array<{ activeMediaRecoveryTask?: { nodeId?: unknown; phase?: unknown } }> }).resources?.[0]?.activeMediaRecoveryTask
		return typeof task?.nodeId === 'string' && task.nodeId !== previousTaskId ? task.phase : null
	}, { timeout: 20_000 }).toMatch(/awaiting-confirmation|completed|failed/)
	const confirm = row.getByRole('button', { name: 'Confirm replacement' })
	if (await confirm.count()) await confirm.click()
}

const readRecoveryStorageCounts = async (page: Page, snapshot: RecoverySnapshot) => page.evaluate(async ({ projectId, resourceId }) => {
	const root = await navigator.storage.getDirectory()
	const projects = await root.getDirectoryHandle('projects')
	const project = await projects.getDirectoryHandle(projectId)
	const assets = await project.getDirectoryHandle('assets')
	const resource = await assets.getDirectoryHandle(resourceId)
	const versions = await resource.getDirectoryHandle('versions') as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }
	let versionCount = 0
	for await (const _ of versions.entries()) versionCount += 1
	let stagingCount = 0
	try {
		const staging = await project.getDirectoryHandle('staging') as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }
		for await (const _ of staging.entries()) stagingCount += 1
	} catch { /* no staging directory */ }
	return { versionCount, stagingCount }
}, snapshot)

test('single mode restores a project media copy and persists post-restore edits', async ({ baseURL }, testInfo) => {
	test.setTimeout(90_000)
	const userDataDir = testInfo.outputPath('single-mode-handle-profile')
	const context = await chromium.launchPersistentContext(userDataDir, {
		baseURL,
		headless: true,
	})
	const page = context.pages()[0] ?? await context.newPage()
	await installOpfsPicker(page)

	try {
		await page.goto('/?__minicut_test_single=1')
		await page.getByLabel('Media bin').locator('.ve-import-button').click()
		const mediaBin = page.getByLabel('Media bin')
		const handleResourceRow = mediaBin.locator('.ve-resource-row').filter({ hasText: 'picked-handle-video.webm' })
		await expect(handleResourceRow).toContainText('Using project copy', { timeout: 20_000 })
		const boot1 = await waitForCompletedRecovery(page)
		await handleResourceRow.getByRole('button', { name: 'Add to timeline' }).click()

		const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(1)
		await timeline.getByRole('button', { name: /picked-handle-video\.webm/i }).first().click()
		await setTimelineCursor(page, 0.5)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(2)

		await page.reload()
		await expect(handleResourceRow).toContainText('Using project copy', { timeout: 20_000 })
		const boot2 = await waitForCompletedRecovery(page, boot1)
		expect(boot2.taskId).not.toBe(boot1.taskId)
		expect(boot2.operationId).not.toBe(boot1.operationId)
		expect(boot2.url).not.toBe(boot1.url)
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(2)

		await timeline.getByRole('button', { name: /picked-handle-video\.webm/i }).nth(1).click()
		await setTimelineCursor(page, 0.75)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(3)
		await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Nudge +0.5s' }).click()

		await page.reload()
		await expect(handleResourceRow).toContainText('Using project copy', { timeout: 20_000 })
		const boot3 = await waitForCompletedRecovery(page, boot2)
		expect(boot3.taskId).not.toBe(boot2.taskId)
		expect(boot3.operationId).not.toBe(boot2.operationId)
		expect(boot3.url).not.toBe(boot2.url)
		expect(boot3.assetRef).toBe(boot1.assetRef)
		await expect(timeline.getByRole('button', { name: /picked-handle-video\.webm/i })).toHaveCount(3)
		expect(await readRecoveryStorageCounts(page, boot3)).toEqual({ versionCount: 1, stagingCount: 0 })
	} finally {
		await context.close()
	}
})

test('project copy survives prompt, denied, and granted permission across reloads', async ({ baseURL }, testInfo) => {
	test.setTimeout(90_000)
	const context = await chromium.launchPersistentContext(testInfo.outputPath('permission-profile'), { baseURL, headless: true })
	const page = context.pages()[0] ?? await context.newPage()
	await installOpfsPicker(page)
	try {
		await page.goto('/?__minicut_test_single=1')
		await page.getByLabel('Media bin').locator('.ve-import-button').click()
		const row = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'picked-handle-video.webm' })
		await expect(row).toContainText('Using project copy', { timeout: 20_000 })
		await row.getByRole('button', { name: 'Add to timeline' }).click()
		const timelineClip = page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /picked-handle-video\.webm/i })
		await expect(timelineClip).toHaveCount(1)
		await page.evaluate(() => {
			localStorage.setItem('minicut-permission-state', 'prompt')
			localStorage.setItem('minicut-permission-stats', '{"queries":0,"requests":0}')
		})

		await page.reload()
		await expect(row).toContainText('Using project copy', { timeout: 20_000 })
		await expect(row.getByRole('button', { name: 'Grant access' })).toBeVisible({ timeout: 20_000 })
		expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minicut-permission-stats') ?? '{}').requests)).toBe(0)
		await page.evaluate(() => localStorage.setItem('minicut-permission-next', 'denied'))
		await row.getByRole('button', { name: 'Grant access' }).click()
		await expect(row).toContainText('Access denied')

		await page.reload()
		await expect(row.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 20_000 })
		const beforeGrant = await page.evaluate(() => JSON.parse(localStorage.getItem('minicut-permission-stats') ?? '{}') as { queries: number; requests: number })
		expect(beforeGrant.requests).toBe(1)
		expect(beforeGrant.queries).toBeGreaterThan(0)
		await page.evaluate(() => localStorage.setItem('minicut-permission-next', 'granted'))
		await row.getByRole('button', { name: 'Try again' }).click()
		await expect(row.getByRole('button', { name: 'Try again' })).toHaveCount(0)

		await page.reload()
		await expect(row).toContainText('Using project copy', { timeout: 20_000 })
		await expect(row.getByRole('button', { name: /Grant access|Try again/ })).toHaveCount(0)
		await expect(timelineClip).toHaveCount(1)
		const finalStats = await page.evaluate(() => JSON.parse(localStorage.getItem('minicut-permission-stats') ?? '{}') as { queries: number; requests: number })
		expect(finalStats.requests).toBe(2)
		expect(finalStats.queries).toBeGreaterThan(beforeGrant.queries)
	} finally {
		await context.close()
	}
})

test('incompatible replacement is rejected and never replaces the durable source', async ({ baseURL }, testInfo) => {
	test.setTimeout(90_000)
	const context = await chromium.launchPersistentContext(testInfo.outputPath('incompatible-profile'), { baseURL, headless: true })
	const page = context.pages()[0] ?? await context.newPage()
	await installOpfsPicker(page)
	try {
		await page.goto('/?__minicut_test_single=1')
		await page.getByLabel('Media bin').locator('.ve-import-button').click()
		const row = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'picked-handle-video.webm' })
		await expect(row).toContainText('Using project copy', { timeout: 20_000 })
		const original = await waitForCompletedRecovery(page)
		await row.getByRole('button', { name: 'Add to timeline' }).click()
		const timelineClip = page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /picked-handle-video\.webm/i })
		await expect(timelineClip).toHaveCount(1)
		await page.evaluate(() => {
			localStorage.setItem('minicut-picker-mode', 'incompatible')
			;(window as Window & { __MINICUT_MEDIA_PROBE_OVERRIDE__?: unknown }).__MINICUT_MEDIA_PROBE_OVERRIDE__ = { kind: 'audio', duration: 1, frameRate: null, timebase: null, width: null, height: null, audioChannels: 2, audioSampleRate: 48000, streams: { videoStreams: 0, audioStreams: 1 } }
		})
		await row.getByRole('button', { name: 'Replace source' }).click()
		await expect(row.getByRole('alert')).toBeVisible({ timeout: 20_000 })
		await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible()
		const rejected = await page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()) as { resources?: Array<{ assetRef?: unknown; url?: unknown; activeMediaRecoveryTask?: { phase?: unknown; reasonCode?: unknown } }> }
		expect(rejected.resources?.[0]?.assetRef).toBe(original.assetRef)
		expect(rejected.resources?.[0]?.activeMediaRecoveryTask).toMatchObject({ phase: 'rejected' })

		await page.reload()
		const boot2 = await waitForCompletedRecovery(page)
		await page.reload()
		const boot3 = await waitForCompletedRecovery(page, boot2)
		expect(boot3.assetRef).toBe(original.assetRef)
		await expect(timelineClip).toHaveCount(1)
		expect(await readRecoveryStorageCounts(page, boot3)).toEqual({ versionCount: 1, stagingCount: 0 })
	} finally {
		await context.close()
	}
})

test('reconciles interrupted commits before and after the durable pointer switch', async ({ baseURL }, testInfo) => {
	test.setTimeout(120_000)
	const context = await chromium.launchPersistentContext(testInfo.outputPath('interrupted-commit-profile'), { baseURL, headless: true })
	const page = context.pages()[0] ?? await context.newPage()
	await installOpfsPicker(page)
	try {
		await page.goto('/?__minicut_test_single=1')
		await page.getByLabel('Media bin').locator('.ve-import-button').click()
		const row = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'picked-handle-video.webm' })
		await expect(row).toContainText('Using project copy', { timeout: 20_000 })
		const original = await waitForCompletedRecovery(page)

		await page.evaluate(() => {
			;(window as Window & { __MINICUT_MEDIA_RECOVERY_FAULT_POINT__?: string }).__MINICUT_MEDIA_RECOVERY_FAULT_POINT__ = 'after-asset-stage'
			;(window as Window & { __MINICUT_MEDIA_PROBE_OVERRIDE__?: unknown }).__MINICUT_MEDIA_PROBE_OVERRIDE__ = { kind: 'video', duration: 6, frameRate: null, timebase: null, width: null, height: null, audioChannels: null, audioSampleRate: null, streams: { videoStreams: 1, audioStreams: null } }
		})
		await row.getByRole('button', { name: 'Replace source' }).click()
		await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 20_000 })
		expect((await page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()) as { resources?: Array<{ assetRef?: unknown }> }).resources?.[0]?.assetRef).toBe(original.assetRef)
		expect(await readRecoveryStorageCounts(page, original)).toEqual({ versionCount: 1, stagingCount: 0 })

		await page.reload()
		const afterRollback = await waitForCompletedRecovery(page)
		expect(afterRollback.assetRef).toBe(original.assetRef)
		await page.evaluate(() => {
			;(window as Window & { __MINICUT_MEDIA_RECOVERY_FAULT_POINT__?: string }).__MINICUT_MEDIA_RECOVERY_FAULT_POINT__ = 'after-pointer-switch'
			;(window as Window & { __MINICUT_MEDIA_PROBE_OVERRIDE__?: unknown }).__MINICUT_MEDIA_PROBE_OVERRIDE__ = { kind: 'video', duration: 6, frameRate: null, timebase: null, width: null, height: null, audioChannels: null, audioSampleRate: null, streams: { videoStreams: 1, audioStreams: null } }
		})
		await row.getByRole('button', { name: 'Replace source' }).click()
		await confirmReplacementIfNeeded(page, row, afterRollback.taskId)
		const switched = await waitForCompletedRecovery(page, afterRollback)
		expect(switched.assetRef).not.toBe(original.assetRef)
		expect((await readRecoveryStorageCounts(page, switched)).versionCount).toBe(2)

		await page.reload()
		const reconciled = await waitForCompletedRecovery(page, switched)
		expect(reconciled.assetRef).toBe(switched.assetRef)
		expect(await readRecoveryStorageCounts(page, reconciled)).toEqual({ versionCount: 1, stagingCount: 0 })
		await page.reload()
		const stable = await waitForCompletedRecovery(page, reconciled)
		expect(stable.assetRef).toBe(switched.assetRef)
		expect(await readRecoveryStorageCounts(page, stable)).toEqual({ versionCount: 1, stagingCount: 0 })
	} finally {
		await context.close()
	}
})

test('keeps commit failure recoverable and retry publishes one stable version', async ({ baseURL }, testInfo) => {
	test.setTimeout(120_000)
	const context = await chromium.launchPersistentContext(testInfo.outputPath('commit-retry-profile'), { baseURL, headless: true })
	const page = context.pages()[0] ?? await context.newPage()
	await installOpfsPicker(page)
	try {
		await page.goto('/?__minicut_test_single=1')
		await page.getByLabel('Media bin').locator('.ve-import-button').click()
		const row = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'picked-handle-video.webm' })
		await expect(row).toContainText('Using project copy', { timeout: 20_000 })
		const original = await waitForCompletedRecovery(page)
		await page.evaluate(() => {
			;(window as Window & { __MINICUT_MEDIA_RECOVERY_FAULT_POINT__?: string }).__MINICUT_MEDIA_RECOVERY_FAULT_POINT__ = 'after-validation'
			;(window as Window & { __MINICUT_MEDIA_PROBE_OVERRIDE__?: unknown }).__MINICUT_MEDIA_PROBE_OVERRIDE__ = { kind: 'video', duration: 6, frameRate: null, timebase: null, width: null, height: null, audioChannels: null, audioSampleRate: null, streams: { videoStreams: 1, audioStreams: null } }
		})
		await row.getByRole('button', { name: 'Replace source' }).click()
		await expect(row.getByRole('alert')).toBeVisible({ timeout: 20_000 })
		const retry = row.getByRole('button', { name: 'Retry' })
		await expect(retry).toBeVisible()
		const failedDetails = await page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()) as { resources?: Array<{ assetRef?: unknown; activeMediaRecoveryTask?: { nodeId?: unknown } }> }
		expect(failedDetails.resources?.[0]?.assetRef).toBe(original.assetRef)
		const failedTaskId = String(failedDetails.resources?.[0]?.activeMediaRecoveryTask?.nodeId ?? '')

		await retry.click()
		await confirmReplacementIfNeeded(page, row, failedTaskId)
		const published = await waitForCompletedRecovery(page, original)
		expect(published.assetRef).not.toBe(original.assetRef)
		await page.reload()
		const boot2 = await waitForCompletedRecovery(page, published)
		await page.reload()
		const boot3 = await waitForCompletedRecovery(page, boot2)
		expect(boot3.assetRef).toBe(published.assetRef)
		expect(await readRecoveryStorageCounts(page, boot3)).toEqual({ versionCount: 1, stagingCount: 0 })
	} finally {
		await context.close()
	}
})
