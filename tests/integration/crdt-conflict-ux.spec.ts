import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

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
	EMPTY_INITIALIZED: 2,
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
					resolve(getRequest.result ?? null)
				}
			}
		})
	}, dbName)

const waitForRuntimeSettled = async (page: Page) => {
	await page.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.())
}

const waitForActiveProject = async (page: Page, title?: string) => {
	await page.waitForFunction(() => {
		const details = window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()
		return typeof details?.projectId === 'string' && details.projectId.length > 0
	})
	if (title) {
		await expect.poll(async () => page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()), {
			timeout: 20_000,
		}).toMatchObject({ title })
	}
}

const waitForFixtureClip = async (page: Page) => {
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const details = window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() as {
						tracks?: Array<{ clips?: Array<{ name?: unknown; mediaKind?: unknown }> }>
					} | null
					return (
						details?.tracks?.some((track) =>
							track.clips?.some((clip) => clip.mediaKind === 'video' || clip.name === 'fixture-video.webm'),
						) ?? false
					)
				}),
			{ timeout: 20_000 },
		)
		.toBe(true)
}

const createProjectViaDebug = async (page: Page, title: string) => {
	await page.evaluate(async (projectTitle) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.dispatchCreateProject) throw new Error('MiniCut debug bridge is unavailable')
		await debug.dispatchCreateProject(projectTitle)
	}, title)
}

const importFixtureVideo = async (page: Page) => {
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	await expect(page.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible({ timeout: 20_000 })
}

const openFirstClipConflictInspector = async (page: Page) => {
	const badge = page.locator('.clip-conflict-badge').first()
	await expect(badge).toBeVisible({ timeout: 20_000 })
	await badge.evaluate((element) => (element as HTMLButtonElement).click())
	return page.getByRole('region', { name: 'Conflict inspector' })
}

const expectNoConflictBadges = async (page: Page) => {
	await expect(page.locator('.clip-conflict-badge')).toHaveCount(0)
}

const expectFirstConflictBadge = async (page: Page) => {
	await expect(page.locator('.clip-conflict-badge').first()).toBeVisible({ timeout: 20_000 })
}

type InjectConflictOptions = {
	timing?: boolean
	summary?: string
}

const injectFirstClipConflict = async (page: Page, options: InjectConflictOptions = {}) =>
	page.evaluate(async (conflictOptions) => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug?.injectFirstClipConflictTesting) throw new Error('Conflict injector is unavailable')
		return debug.injectFirstClipConflictTesting(conflictOptions)
	}, options)

const injectFirstClipConflictUntilBadge = async (page: Page, options: InjectConflictOptions = {}) => {
	let fixture: unknown = null
	await expect
		.poll(
			async () => {
				fixture = await injectFirstClipConflict(page, options)
				return page.locator('.clip-conflict-badge').count()
			},
			{ timeout: 20_000, intervals: [100, 250, 500] },
		)
		.toBeGreaterThan(0)
	return fixture
}

const setupClipProject = async (page: Page, title: string) => {
	const roomId = `clip-project-${Date.now()}-${Math.random().toString(36).slice(2)}`
	await enableDebugBridge(page)
	await page.goto(`/#/${roomId}`)
	await waitForDebugBridge(page)
	await createProjectViaDebug(page, title)
	await waitForRuntimeSettled(page)
	await importFixtureVideo(page)
	await waitForRuntimeSettled(page)
	await waitForFixtureClip(page)
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

	test('@crdt-smoke keeps room bookmark -> workspace/db identity stable across reload', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'crdt-ui-indexeddb', 'CRDT harness storage smoke runs only in the CRDT Playwright profile')
		const roomId = `bookmark-room-${Date.now()}`
		await enableDebugBridge(page)
		await page.goto(`/#/${roomId}`)
		await waitForDebugBridge(page)

		const first = await readStorageSnapshot(page)
		expect((first.snapshot as { sessionKey?: unknown } | null)?.sessionKey).toBe(roomId)
		expect((first.snapshot as { workspaceOpenState?: { status?: unknown; failureReason?: unknown } } | null)?.workspaceOpenState).toEqual({
			status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
			failureReason: 0,
		})
		expect((first.workerState as { crdt?: { storageOpen?: { manifest?: { workspaceId?: unknown }; status?: unknown; statusLabel?: unknown } } } | null)?.crdt?.storageOpen).toMatchObject({
			status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
			statusLabel: 'empty_initialized',
			manifest: { workspaceId: createHarnessWorkspaceId(roomId) },
		})
		await page.getByRole('button', { name: 'CRDT', exact: true }).click()
		const panel = page.getByRole('region', { name: 'CRDT debug panel' })
		await expect(panel).toContainText(createHarnessWorkspaceId(roomId))
		await expect(panel).toContainText(createHarnessDbName(roomId))
		await expect(panel).toContainText('empty')

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

	test('@crdt-conflict shows timing conflict, failed resolution, and cleared resolution', async ({ page }) => {
		await setupClipProject(page, `CRDT conflict ${Date.now()}`)
		const fixture = await injectFirstClipConflictUntilBadge(page, {
			timing: true,
			summary: 'Duration has concurrent edits',
		})
		const inspector = await openFirstClipConflictInspector(page)
		await expect(inspector.getByText('Duration has concurrent edits')).toBeVisible()
		await expect(inspector.getByText(/Timing conflict.*clipTiming/)).toBeVisible()

		await inspector.getByLabel('Duration').fill('0')
		await inspector.getByRole('button', { name: 'Resolve timing' }).click()
		await page.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.injectFirstClipResolutionErrorTesting?.())
		await expect(inspector.getByText('Duration must be greater than 0')).toBeVisible()
		await expect(inspector.getByText('duration_must_be_positive')).toBeVisible()
		await expect(inspector.getByRole('button', { name: 'Resolve timing' })).toBeEnabled()

		await inspector.getByLabel('Duration').fill('3')
		await inspector.getByRole('button', { name: 'Resolve timing' }).click()
		await page.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.clearFirstClipConflictTesting?.())
		await expectNoConflictBadges(page)
		expect((fixture as { conflictId?: unknown }).conflictId).toContain('timing:playwright')
	})

	test('@crdt-conflict syncs controlled conflict UX across two room tabs', async ({ context }) => {
		const firstPage = await context.newPage()
		const secondPage = await context.newPage()
		const roomId = `two-tab-room-${Date.now()}`
		await Promise.all([enableDebugBridge(firstPage), enableDebugBridge(secondPage)])
		await Promise.all([firstPage.goto(`/#/${roomId}`), secondPage.goto(`/#/${roomId}`)])
		await Promise.all([waitForDebugBridge(firstPage), waitForDebugBridge(secondPage)])

		const [firstStorage, secondStorage] = await Promise.all([
			readStorageSnapshot(firstPage),
			readStorageSnapshot(secondPage),
		])
		for (const storage of [firstStorage, secondStorage]) {
			expect((storage.snapshot as { sessionKey?: unknown } | null)?.sessionKey).toBe(roomId)
			expect((storage.workerState as { crdt?: { storageOpen?: { manifest?: { workspaceId?: unknown }; status?: unknown } } } | null)?.crdt?.storageOpen).toMatchObject({
				manifest: { workspaceId: createHarnessWorkspaceId(roomId) },
			})
		}
		expect((firstStorage.workerState as { crdt?: { storageOpen?: { manifest?: { workspaceId?: unknown } } } } | null)?.crdt?.storageOpen?.manifest?.workspaceId)
			.toBe((secondStorage.workerState as { crdt?: { storageOpen?: { manifest?: { workspaceId?: unknown } } } } | null)?.crdt?.storageOpen?.manifest?.workspaceId)

		const title = `CRDT two tab ${Date.now()}`
		await createProjectViaDebug(firstPage, title)
		await waitForRuntimeSettled(firstPage)
		await waitForRuntimeSettled(secondPage)
		await importFixtureVideo(firstPage)
		await waitForRuntimeSettled(firstPage)
		await waitForRuntimeSettled(secondPage)

		await expect(secondPage.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			injectFirstClipConflictUntilBadge(firstPage, { timing: true }),
			injectFirstClipConflictUntilBadge(secondPage, { timing: true }),
		])

		await openFirstClipConflictInspector(firstPage)
		await openFirstClipConflictInspector(secondPage)
		await firstPage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.clearFirstClipConflictTesting?.())
		await secondPage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.clearFirstClipConflictTesting?.())

		await expectNoConflictBadges(firstPage)
		await expectNoConflictBadges(secondPage)
	})

	test('@crdt-conflict reloads the CRDT test harness and keeps debug UX usable', async ({ page }) => {
		const title = `CRDT reload ${Date.now()}`
		await setupClipProject(page, title)
		await injectFirstClipConflictUntilBadge(page, { timing: true })
		await expectFirstConflictBadge(page)

		await page.reload()
		await waitForDebugBridge(page)
		const reloadedTitle = `CRDT reload after ${Date.now()}`
		await createProjectViaDebug(page, reloadedTitle)
		await waitForActiveProject(page, reloadedTitle)
		await importFixtureVideo(page)
		await waitForFixtureClip(page)
		await injectFirstClipConflictUntilBadge(page, { timing: true })
		await expectFirstConflictBadge(page)
	})
})
