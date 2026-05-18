import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const enableDebugBridge = async (page: Page) => {
	await page.addInitScript(() => {
		;(window as Window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ = true
	})
}

const waitForDebugBridge = async (page: Page) => {
	await page.waitForFunction(() => window.__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true)
}

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

const setupClipProject = async (page: Page, title: string) => {
	await enableDebugBridge(page)
	await page.goto('/')
	await waitForDebugBridge(page)
	await createProjectViaDebug(page, title)
	await waitForRuntimeSettled(page)
	await importFixtureVideo(page)
	await waitForRuntimeSettled(page)
	await waitForFixtureClip(page)
}

test.describe('CRDT UI E2E', () => {
	test('@crdt-smoke boots the worker with IndexedDB CRDT storage', async ({ page }) => {
		await enableDebugBridge(page)
		await page.goto('/')
		await waitForDebugBridge(page)

		await createProjectViaDebug(page, `CRDT smoke ${Date.now()}`)
		const details = await page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.())
		expect((details as { projectId?: unknown } | null)?.projectId).toEqual(expect.stringMatching(/^crdt:/))
	})

	test('@crdt-conflict shows timing conflict, failed resolution, and cleared resolution', async ({ page }) => {
		await setupClipProject(page, `CRDT conflict ${Date.now()}`)
		const fixture = await page.evaluate(async () => {
			const debug = window.__MINICUT_P2P_DEBUG__
			if (!debug?.injectFirstClipConflictTesting) throw new Error('Conflict injector is unavailable')
			return debug.injectFirstClipConflictTesting({
				timing: true,
				summary: 'Duration has concurrent edits',
			})
		})
		await expect.poll(async () => page.evaluate(() => {
			const graph = window.__MINICUT_P2P_DEBUG__?.dumpGraph?.() as {
				nodes?: Array<{ attrs?: Record<string, unknown> }>
			} | null
			return graph?.nodes
				?.map((node) => node.attrs?.['$meta$aggregates$crdt$clipTiming$open_conflicts_count'] ?? null) ?? []
		}), { timeout: 5_000 }).toContain(1)

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
		expect(fixture.conflictId).toContain('timing:playwright')
	})

	test('@crdt-conflict syncs controlled conflict UX across two tabs', async ({ context }) => {
		const firstPage = await context.newPage()
		const secondPage = await context.newPage()
		await Promise.all([enableDebugBridge(firstPage), enableDebugBridge(secondPage)])
		await Promise.all([firstPage.goto('/'), secondPage.goto('/')])
		await Promise.all([waitForDebugBridge(firstPage), waitForDebugBridge(secondPage)])

		const title = `CRDT two tab ${Date.now()}`
		await createProjectViaDebug(firstPage, title)
		await waitForRuntimeSettled(firstPage)
		await waitForRuntimeSettled(secondPage)
		await importFixtureVideo(firstPage)
		await waitForRuntimeSettled(firstPage)
		await waitForRuntimeSettled(secondPage)

		await expect(secondPage.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			firstPage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.injectFirstClipConflictTesting?.({ timing: true })),
			secondPage.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.injectFirstClipConflictTesting?.({ timing: true })),
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
		await page.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.injectFirstClipConflictTesting?.({ timing: true }))
		await expectFirstConflictBadge(page)

		await page.reload()
		await waitForDebugBridge(page)
		await waitForActiveProject(page)
		const reloadedTitle = `CRDT reload after ${Date.now()}`
		await createProjectViaDebug(page, reloadedTitle)
		await waitForActiveProject(page, reloadedTitle)
		await importFixtureVideo(page)
		await waitForFixtureClip(page)
		await page.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.injectFirstClipConflictTesting?.({ timing: true }))
		await expectFirstConflictBadge(page)
	})
})
