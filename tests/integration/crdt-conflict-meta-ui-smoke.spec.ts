import { chromium, expect, test, type Page } from '@playwright/test'
import path from 'node:path'

// This spec injects conflict meta to smoke-test UI rendering only.
// It does not prove real CRDT conflict generation or propagation.

const indexedDbStores = [
	'dkt_manifest',
	'dkt_migration_history',
	'dkt_schema',
	'dkt_meta',
	'dkt_models',
	'dkt_removed_models',
	'dkt_attrs',
	'dkt_rels',
	'dkt_mentions',
	'dkt_mention_names',
	'dkt_expected_rels',
	'crdt_batches',
	'crdt_batch_outbox',
	'crdt_clock',
	'crdt_applied_batches',
	'crdt_conflicts',
	'crdt_checkpoints',
	'crdt_profile',
	'crdt_meta',
	'commit_journal',
] as const

const encodeWorkspacePart = (value: string) =>
	encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
		`%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	)

const createHarnessWorkspaceId = (roomId: string) => `harness:room:${encodeWorkspacePart(roomId)}`
const createHarnessDbName = (roomId: string) =>
	`minicut-crdt-workspace-${encodeWorkspacePart(createHarnessWorkspaceId(roomId))}`

const WORKSPACE_OPEN_STATUS = {
	READY: 1,
	LOCAL_EMPTY_READY: 2,
} as const

const gotoIndexedDbSeedPage = async (page: Page) => {
	await page.goto('/test-idb-seed.html')
}

const enableDebugBridge = async (page: Page) => {
	await page.addInitScript(() => {
		;(window as Window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ = true
	})
}

const waitForDebugBridge = async (page: Page) => {
	await page.waitForFunction(() => window.__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true)
}

const readStorageSnapshot = async (page: Page) => {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			return await page.evaluate(async () => {
				const debug = window.__MINICUT_P2P_DEBUG__
				return {
					snapshot: debug?.getSnapshot?.() ?? null,
					workerState: await debug?.dumpWorkerState?.(),
				}
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (!message.includes('Execution context was destroyed')) {
				throw error
			}
			await page.waitForTimeout(100)
		}
	}
	throw new Error('Timed out while reading CRDT storage snapshot')
}

const waitForStorageSnapshot = async (page: Page, roomId: string) => {
	let latest: Awaited<ReturnType<typeof readStorageSnapshot>> | null = null
	await expect.poll(async () => {
		latest = await readStorageSnapshot(page)
		const snapshot = latest.snapshot as { sessionKey?: unknown } | null
		return snapshot?.sessionKey
	}, {
		timeout: 20_000,
	}).toBe(roomId)
	if (!latest) {
		throw new Error('Expected CRDT storage snapshot')
	}
	return latest
}

const seedIndexedDbManifest = async (page: Page, dbName: string, manifest: Record<string, unknown>) => {
	await page.evaluate(
		async ({ dbName, manifest, stores }) => {
			const verifySeed = () =>
				new Promise<void>((resolve, reject) => {
					const request = indexedDB.open(dbName)
					request.onerror = () => reject(request.error)
					request.onsuccess = () => {
						const db = request.result
						if (!db.objectStoreNames.contains('dkt_manifest')) {
							db.close()
							reject(new Error(`manifest store missing after seed for ${dbName}`))
							return
						}
						const tx = db.transaction(['dkt_manifest'], 'readonly')
						const getRequest = tx.objectStore('dkt_manifest').get('manifest')
						getRequest.onerror = () => reject(getRequest.error)
						getRequest.onsuccess = () => {
							db.close()
							if (!getRequest.result) {
								reject(new Error(`manifest seed verification failed for ${dbName}`))
								return
							}
							resolve()
						}
					}
				})

			await new Promise<void>((resolve, reject) => {
				const deleteRequest = indexedDB.deleteDatabase(dbName)
				deleteRequest.onerror = () => reject(deleteRequest.error)
				deleteRequest.onblocked = () => reject(new Error(`delete blocked for ${dbName}`))
				deleteRequest.onsuccess = () => {
					const request = indexedDB.open(dbName, 1)
					request.onupgradeneeded = () => {
						const db = request.result
						for (const store of stores) {
							if (!db.objectStoreNames.contains(store)) {
								db.createObjectStore(store)
							}
						}
					}
					request.onerror = () => reject(request.error)
					request.onsuccess = () => {
						const db = request.result
						const tx = db.transaction(['dkt_manifest'], 'readwrite')
						const store = tx.objectStore('dkt_manifest')
						const putRequest = store.put(manifest, 'manifest')
						putRequest.onerror = () => reject(putRequest.error)
						putRequest.onsuccess = () => {
							const getRequest = store.get('manifest')
							getRequest.onerror = () => reject(getRequest.error)
							getRequest.onsuccess = () => {
								if (!getRequest.result) {
									reject(new Error(`manifest seed verification failed for ${dbName}`))
								}
							}
						}
						tx.oncomplete = () => {
							db.close()
							resolve()
						}
						tx.onerror = () => reject(tx.error)
						tx.onabort = () => reject(tx.error)
					}
				}
			})
			await verifySeed()
		},
		{ dbName, manifest, stores: [...indexedDbStores] },
	)
}

const readIndexedDbManifest = async (page: Page, dbName: string) =>
	page.evaluate(async (targetDbName) => {
		return await new Promise<unknown>((resolve, reject) => {
			const request = indexedDB.open(targetDbName)
			request.onerror = () => reject(request.error)
			request.onsuccess = () => {
				const db = request.result
				if (!db.objectStoreNames.contains('dkt_manifest')) {
					db.close()
					resolve(null)
					return
				}
				const tx = db.transaction(['dkt_manifest'], 'readonly')
				const getRequest = tx.objectStore('dkt_manifest').get('manifest')
				getRequest.onerror = () => reject(getRequest.error)
				getRequest.onsuccess = () => {
					db.close()
					const value = getRequest.result
					if (value instanceof Uint8Array && value[0] === 1) {
						resolve(JSON.parse(new TextDecoder().decode(value.subarray(1))))
						return
					}
					resolve(value ?? null)
				}
			}
		})
	}, dbName)

const createProjectViaDebug = async (page: Page, title: string) => {
	await page.evaluate(async (projectTitle) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.dispatchCreateProject) throw new Error('MiniCut debug bridge is unavailable')
		await debug.dispatchCreateProject(projectTitle)
	}, title)
}

const waitForRuntimeSettled = async (page: Page) => {
	await page.evaluate(async () => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.waitForRuntimeSettled) throw new Error('MiniCut debug bridge is unavailable')
		await debug.waitForRuntimeSettled()
	})
}

const readRestoreSummary = async (page: Page) =>
	page.evaluate(async () => {
		const debug = window.__MINICUT_P2P_DEBUG__
		const details = debug?.getActiveProjectDetails?.() as {
			title?: unknown
			tracks?: Array<{
				kind?: unknown
				clips?: Array<{
					name?: unknown
					start?: unknown
					duration?: unknown
				}>
			}>
		} | null
		const graph = debug?.dumpGraph?.() as {
			dict?: unknown
			nodes?: unknown
		} | null
		const workerState = await debug?.dumpWorkerState?.() as {
			crdt?: {
				durableLogCount?: unknown
				storageOpen?: { status?: unknown; statusLabel?: unknown }
			}
		} | null
		const nodes: Array<{ modelName?: unknown; model_name?: unknown; attrs?: unknown }> = []
		if (Array.isArray(graph?.nodes)) {
			nodes.push(...graph.nodes as typeof nodes)
		}
		if (graph?.dict && typeof graph.dict === 'object') {
			nodes.push(...Object.values(graph.dict as Record<string, unknown>).filter((node): node is typeof nodes[number] =>
				Boolean(node && typeof node === 'object'),
			))
		}
		const effectKinds = nodes
			.filter((node) => (node.modelName ?? node.model_name) === 'effect')
			.map((node) => {
				const attrs = node.attrs && typeof node.attrs === 'object'
					? node.attrs as { kind?: unknown; enabled?: unknown }
					: null
				return {
					kind: typeof attrs?.kind === 'string' ? attrs.kind : null,
					enabled: attrs?.enabled !== false,
				}
			})

		return {
			details,
			effectKinds,
			storageOpen: workerState?.crdt?.storageOpen ?? null,
			durableLogCount: typeof workerState?.crdt?.durableLogCount === 'number'
				? workerState.crdt.durableLogCount
				: 0,
		}
	})

const readSelectionState = async (page: Page) =>
	page.evaluate(() => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.getSelectionState) throw new Error('MiniCut debug bridge is unavailable')
		return debug.getSelectionState() as {
			selectedEntityId?: unknown
			selectedClip?: { name?: unknown } | null
			selectedClipSummary?: unknown
		} | null
	})

const setTimelineCursor = async (page: Page, cursor: number) => {
	await page.evaluate(async (nextCursor) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.dispatchRootAction) throw new Error('MiniCut debug bridge is unavailable')
		await debug.dispatchRootAction('setCursor', nextCursor)
	}, cursor)
}

const getVideoTrackClipsByName = async (page: Page, clipName: string) => {
	const summary = await readRestoreSummary(page)
	const videoTrack = summary.details?.tracks?.find((track) => track.kind === 'video')
	return [...(videoTrack?.clips ?? [])]
		.filter((clip) => clip.name === clipName)
		.sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0))
}

const expectVideoTrackClipsByName = async (
	page: Page,
	clipName: string,
	count: number,
) => {
	await expect.poll(async () => (await getVideoTrackClipsByName(page, clipName)).length, {
		timeout: 10_000,
	}).toBe(count)
	return getVideoTrackClipsByName(page, clipName)
}

const importMediaFile = async (page: Page, filePath: string, fileName: string) => {
	await page.getByLabel('Import media files').setInputFiles(filePath)
	await expect.poll(
		async () => page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: fileName }).count(),
		{ timeout: 45_000 },
	).toBeGreaterThan(0)
}

const addResourceToTimeline = async (page: Page, resourceName: string) => {
	const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
	await page
		.getByLabel('Media bin')
		.locator('.ve-resource-row')
		.filter({ hasText: resourceName })
		.getByRole('button', { name: 'Add to timeline' })
		.click()
	await expect(timeline.getByRole('button', { name: new RegExp(resourceName, 'i') })).toBeVisible()
}

test.describe('CRDT UI E2E', () => {
	test('@crdt-smoke boots the worker with IndexedDB CRDT storage', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'crdt-ui-indexeddb', 'CRDT harness storage smoke runs only in the CRDT Playwright profile')
		const roomId = `smoke-room-${Date.now()}`
		await enableDebugBridge(page)
		await page.goto(`/#/${roomId}`)
		await waitForDebugBridge(page)

		await createProjectViaDebug(page, `CRDT smoke ${Date.now()}`)
		const details = await page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.())
		expect((details as { projectId?: unknown } | null)?.projectId).toEqual(expect.any(String))

		await page.getByRole('button', { name: 'CRDT', exact: true }).click()
		const panel = page.getByRole('region', { name: 'CRDT debug panel' })
		await expect(panel).toContainText('CRDT harness')
		await expect(panel).toContainText('minicut-crdt-workspace-')
		await expect(panel).toContainText(createHarnessWorkspaceId(roomId))
		await expect(panel).toContainText(createHarnessDbName(roomId))
		await expect(panel).toContainText('open')
		await expect(panel).toContainText('ready')
		await expect(panel.getByRole('button', { name: 'Export JSON' })).toBeVisible()
		await expect(panel.getByRole('button', { name: 'Reset IndexedDB' })).toBeVisible()
		await expect(panel).not.toContainText('CRDT boot/storage issue')
		await expect(page.getByRole('alert')).toHaveCount(0)
	})

	for (const reloadCount of [1, 2]) {
		test(`@crdt-smoke keeps room bookmark -> workspace/db identity stable across reload (${reloadCount} reloads)`, async ({ page }, testInfo) => {
			test.skip(testInfo.project.name !== 'crdt-ui-indexeddb', 'CRDT harness storage smoke runs only in the CRDT Playwright profile')
			const roomId = `bookmark-room-${Date.now()}`
			await enableDebugBridge(page)
			await page.goto(`/#/${roomId}`)
			await waitForDebugBridge(page)

			const first = await readStorageSnapshot(page)
			expect((first.snapshot as { sessionKey?: unknown } | null)?.sessionKey).toBe(roomId)
			expect((first.snapshot as { workspaceOpenState?: { status?: unknown; failureReason?: unknown } } | null)?.workspaceOpenState).toEqual({
				status: WORKSPACE_OPEN_STATUS.LOCAL_EMPTY_READY,
				failureReason: 0,
			})
			expect((first.workerState as { crdt?: { storageOpen?: { manifest?: { workspaceId?: unknown }; status?: unknown; statusLabel?: unknown } } } | null)?.crdt?.storageOpen).toMatchObject({
				status: WORKSPACE_OPEN_STATUS.LOCAL_EMPTY_READY,
				statusLabel: 'local_empty_ready',
				manifest: { workspaceId: createHarnessWorkspaceId(roomId) },
			})
			await page.getByRole('button', { name: 'CRDT', exact: true }).click()
			const panel = page.getByRole('region', { name: 'CRDT debug panel' })
			await expect(panel).toContainText(createHarnessWorkspaceId(roomId))
			await expect(panel).toContainText(createHarnessDbName(roomId))
			await expect(panel).toContainText('empty')

			for (let reloadIndex = 0; reloadIndex < reloadCount; reloadIndex++) {
				await page.reload()
				await waitForDebugBridge(page)
				const second = await readStorageSnapshot(page)
				expect((second.snapshot as { sessionKey?: unknown } | null)?.sessionKey).toBe(roomId)
				expect((second.snapshot as { workspaceOpenState?: { status?: unknown; failureReason?: unknown } } | null)?.workspaceOpenState).toEqual({
					status: WORKSPACE_OPEN_STATUS.READY,
					failureReason: 0,
				})
				expect((second.workerState as { crdt?: { storageOpen?: { manifest?: { workspaceId?: unknown }; status?: unknown; statusLabel?: unknown } } } | null)?.crdt?.storageOpen).toMatchObject({
					status: WORKSPACE_OPEN_STATUS.READY,
					statusLabel: 'ready',
					manifest: { workspaceId: createHarnessWorkspaceId(roomId) },
				})
				await page.getByRole('button', { name: 'CRDT', exact: true }).click()
				await expect(panel).toContainText(createHarnessWorkspaceId(roomId))
				await expect(panel).toContainText(createHarnessDbName(roomId))
			}
		})
	}

	test('@crdt-smoke restores edited project state and renders it after browser restart', async ({ baseURL }, testInfo) => {
		test.skip(testInfo.project.name !== 'crdt-ui-indexeddb', 'CRDT harness storage smoke runs only in the CRDT Playwright profile')
		const roomId = `restore-ui-${Date.now()}`
		const userDataDir = testInfo.outputPath('persistent-profile')
		const clipName = 'Persistent caption'
		const importedResourceName = 'fixture-video.webm'
		const importedResourcePath = path.resolve('tests/fixtures/media', importedResourceName)

		const launchApp = async () => {
			const context = await chromium.launchPersistentContext(userDataDir, {
				baseURL,
				headless: true,
			})
			await context.addInitScript(() => {
				;(window as Window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ = true
			})
			const page = context.pages()[0] ?? await context.newPage()
			await page.goto(`/#/${roomId}`)
			await waitForDebugBridge(page)
			return { context, page }
		}

		const first = await launchApp()
		try {
			await first.page.getByLabel('Media bin').getByRole('button', { name: 'Add Text to Timeline' }).click()
			const timeline = first.page.getByRole('region', { name: 'Timeline', exact: true })
			const initialTextClip = timeline.getByRole('button', { name: /^Resize clip start Text\b/i }).first()
			await expect(initialTextClip).toBeVisible()
			await initialTextClip.click()

			const inspector = first.page.getByRole('complementary', { name: 'Inspector' })
			await inspector.getByRole('textbox', { name: 'Clip name' }).fill(clipName)
			await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(1)
			await setTimelineCursor(first.page, 1)
			await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
			await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(2)
			await timeline.getByRole('button', { name: new RegExp(clipName, 'i') }).first().click()
			await inspector.getByRole('button', { name: 'Tint' }).click()
			await expect(inspector.getByText('1 effects')).toBeVisible()
			await waitForRuntimeSettled(first.page)
			await expect.poll(async () => (await readRestoreSummary(first.page)).durableLogCount, {
				timeout: 20_000,
			}).toBeGreaterThan(0)
		} finally {
			await first.context.close()
		}

		const second = await launchApp()
		try {
			await waitForStorageSnapshot(second.page, roomId)
			const summary = await readRestoreSummary(second.page)
			expect(summary.storageOpen).toMatchObject({
				status: WORKSPACE_OPEN_STATUS.READY,
				statusLabel: 'ready',
			})
			expect(summary.details?.title).toBe('Project 1')
			const videoTrack = summary.details?.tracks?.find((track) => track.kind === 'video')
			const restoredClips = [...(videoTrack?.clips ?? [])]
				.filter((clip) => clip.name === clipName)
				.sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0))
			expect(restoredClips).toHaveLength(2)
			expect(restoredClips.map((clip) => clip.duration)).toEqual([1, 2])
			expect(summary.effectKinds).toEqual(expect.arrayContaining([
				expect.objectContaining({ kind: 'tint', enabled: true }),
			]))

			const timeline = second.page.getByRole('region', { name: 'Timeline', exact: true })
			await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(2)

			await timeline.getByRole('button', { name: new RegExp(clipName, 'i') }).nth(1).click()
			await setTimelineCursor(second.page, 2)
			await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
			const textClipsAfterReloadSplit = await expectVideoTrackClipsByName(second.page, clipName, 3)
			expect(textClipsAfterReloadSplit.map((clip) => clip.duration)).toEqual([1, 1, 1])
			await expect(timeline.getByRole('button', { name: new RegExp(clipName, 'i') })).toHaveCount(3)

			await importMediaFile(second.page, importedResourcePath, importedResourceName)
			await addResourceToTimeline(second.page, importedResourceName)
			const importedClips = await expectVideoTrackClipsByName(second.page, importedResourceName, 1)
			const importedStart = Number(importedClips[0]?.start ?? 0)
			await timeline.getByRole('button', { name: new RegExp(importedResourceName, 'i') }).first().click()
			await setTimelineCursor(second.page, importedStart + 0.5)
			await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()
			const importedSplitClips = await expectVideoTrackClipsByName(second.page, importedResourceName, 2)
			expect(importedSplitClips[0]?.duration).toBeCloseTo(0.5, 5)
			await expect(timeline.getByRole('button', { name: new RegExp(importedResourceName, 'i') })).toHaveCount(2)

			await timeline.getByRole('button', { name: new RegExp(importedResourceName, 'i') }).nth(1).click()
			await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Nudge +0.5s' }).click()
			const importedNudgedClips = await expectVideoTrackClipsByName(second.page, importedResourceName, 2)
			expect(importedNudgedClips[1]?.start).toBeCloseTo(importedStart + 1, 5)
			await expect(timeline.getByRole('button', { name: new RegExp(importedResourceName, 'i') }).nth(1)).toContainText(`${(importedStart + 1).toFixed(1)}s`)

			await timeline.getByRole('button', { name: new RegExp(clipName, 'i') }).first().click()
			await expect.poll(async () => (await readSelectionState(second.page))?.selectedClip?.name ?? null, {
				timeout: 10_000,
			}).toBe(clipName)
			await setTimelineCursor(second.page, 0.5)
			await expect(second.page.getByRole('region', { name: 'Preview panel' })).toContainText('Text')
		} finally {
			await second.context.close()
		}
	})

	test('@crdt-smoke reset clears only the current workspace db', async ({ page, context }, testInfo) => {
		test.skip(testInfo.project.name !== 'crdt-ui-indexeddb', 'CRDT harness storage smoke runs only in the CRDT Playwright profile')
		const roomA = `reset-a-${Date.now()}`
		const roomB = `reset-b-${Date.now()}`
		const dbNameA = createHarnessDbName(roomA)
		const dbNameB = createHarnessDbName(roomB)
		const seededRoomACreatedAt = '2026-01-01T00:00:00.000Z'
		const inspector = await context.newPage()

		await gotoIndexedDbSeedPage(inspector)
		await seedIndexedDbManifest(inspector, dbNameA, {
			manifestVersion: 1,
			storageVersion: 1,
			schemaVersion: 1,
			appId: 'minicut',
			profileId: 'minicut-crdt-v1',
			schemaDictionaryMode: 'none',
			kind: 'dkt-workspace',
			workspaceId: createHarnessWorkspaceId(roomA),
			dktStorageVersion: 1,
			appSchemaVersion: 1,
			derivedSchemaVersion: 1,
			createdAt: seededRoomACreatedAt,
		})
		await seedIndexedDbManifest(inspector, dbNameB, {
			manifestVersion: 1,
			storageVersion: 1,
			schemaVersion: 1,
			appId: 'minicut',
			profileId: 'minicut-crdt-v1',
			schemaDictionaryMode: 'none',
			kind: 'dkt-workspace',
			workspaceId: createHarnessWorkspaceId(roomB),
			dktStorageVersion: 1,
			appSchemaVersion: 1,
			derivedSchemaVersion: 1,
			createdAt: new Date().toISOString(),
		})
		await expect.poll(async () => readIndexedDbManifest(inspector, dbNameA)).toMatchObject({
			workspaceId: createHarnessWorkspaceId(roomA),
		})
		await expect.poll(async () => readIndexedDbManifest(inspector, dbNameB)).toMatchObject({
			workspaceId: createHarnessWorkspaceId(roomB),
		})

		await enableDebugBridge(page)
		await page.goto(`/#/${roomA}`)
		await waitForDebugBridge(page)

		page.once('dialog', (dialog) => dialog.accept())
		await page.getByRole('button', { name: 'CRDT', exact: true }).click()
		await page.getByRole('button', { name: 'Reset IndexedDB' }).click()
		await waitForDebugBridge(page)

		await expect.poll(async () => readIndexedDbManifest(inspector, dbNameA)).toMatchObject({
			workspaceId: createHarnessWorkspaceId(roomA),
		})
		expect((await readIndexedDbManifest(inspector, dbNameA)) as { createdAt?: unknown } | null).not.toMatchObject({
			createdAt: seededRoomACreatedAt,
		})
		await expect.poll(async () => readIndexedDbManifest(inspector, dbNameB)).toMatchObject({
			workspaceId: createHarnessWorkspaceId(roomB),
		})
		await inspector.close()
	})

})
