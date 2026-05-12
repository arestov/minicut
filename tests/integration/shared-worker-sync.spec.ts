import { expect, test } from '@playwright/test'
import path from 'node:path'

/**
 * Create a project with a unique title via the debug bridge so selection
 * is unambiguous even when auto-seeding has already created "Project 1"
 * on both pages concurrently.
 */
const createProjectViaDebugBridge = async (
	page: import('@playwright/test').Page,
	title: string,
): Promise<void> => {
	await page.evaluate(async (nextTitle) => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				dispatchCreateProject: (title?: string) => Promise<unknown>
			}
		}).__MINICUT_P2P_DEBUG__
		if (!debug) throw new Error('P2P debug bridge is unavailable')
		await debug.dispatchCreateProject(nextTitle)
	}, title)
}

type DebugProjectDetails = {
	projectId?: unknown
	title?: unknown
	resources?: Array<{ name?: unknown; kind?: unknown }>
	tracks?: Array<{
		kind?: unknown
		clips?: Array<{ name?: unknown; mediaKind?: unknown }>
	}>
}

const getActiveProjectDetails = async (page: import('@playwright/test').Page): Promise<DebugProjectDetails | null> =>
	page.evaluate(() => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				getActiveProjectDetails?: () => unknown
			}
		}).__MINICUT_P2P_DEBUG__
		return (debug?.getActiveProjectDetails?.() ?? null) as DebugProjectDetails | null
	})

const waitForRuntimeSettled = async (page: import('@playwright/test').Page): Promise<void> => {
	await page.evaluate(async () => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				waitForRuntimeSettled?: () => Promise<void>
			}
		}).__MINICUT_P2P_DEBUG__

		await debug?.waitForRuntimeSettled?.()
	})
}

const getProjectTitles = async (page: import('@playwright/test').Page): Promise<string[]> =>
	page.evaluate(() => {
		const debug = (window as typeof window & {
			__MINICUT_P2P_DEBUG__?: {
				getProjectTitles?: () => string[]
			}
		}).__MINICUT_P2P_DEBUG__

		return debug?.getProjectTitles?.() ?? []
	})

const expectSyncedImportedVideoProject = async (
	page: import('@playwright/test').Page,
	title: string,
): Promise<void> => {
	await expect.poll(async () => {
		const project = await getActiveProjectDetails(page)
		return {
			title: project?.title ?? null,
			hasVideoResource: project?.resources?.some((resource) =>
				resource.name === 'fixture-video.webm' && resource.kind === 'video',
			) ?? false,
			hasVideoClip: project?.tracks?.some((track) =>
				track.kind === 'video'
				&& track.clips?.some((clip) => clip.name === 'fixture-video.webm' && clip.mediaKind === 'video'),
			) ?? false,
		}
	}, { timeout: 20_000 }).toEqual({
		title,
		hasVideoResource: true,
		hasVideoClip: true,
	})
}

test('shared worker synchronizes project patches across browser pages', async ({ context }) => {
	const firstPage = await context.newPage()
	const secondPage = await context.newPage()

	await Promise.all([firstPage.goto('/'), secondPage.goto('/')])
	await expect(firstPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(secondPage.getByRole('heading', { name: 'minicut' })).toBeVisible()

	// Create a project with a unique title so the selector is unambiguous even
	// when auto-seeding has already added "Project 1" on both pages.
	const uniqueTitle = `SyncTest-${Date.now()}`
	await createProjectViaDebugBridge(firstPage, uniqueTitle)
	await waitForRuntimeSettled(firstPage)
	await waitForRuntimeSettled(secondPage)
	await expect.poll(() => getProjectTitles(secondPage), { timeout: 20_000 }).toContain(uniqueTitle)
	await expect(firstPage.getByLabel('Projects').getByRole('button', { name: uniqueTitle })).toBeVisible()

	// secondPage should receive the project via SharedWorker; open its dropdown
	// and switch to the unique project.
	const secondProjectsRegion = secondPage.getByLabel('Projects')
	await secondProjectsRegion.getByRole('button').click()
	await expect(secondProjectsRegion.getByRole('menuitem', { name: uniqueTitle })).toBeVisible({ timeout: 10_000 })
	await secondProjectsRegion.getByRole('menuitem', { name: uniqueTitle }).click()

	await firstPage.bringToFront()
	const importInput = firstPage.getByLabel('Import media files')
	await expect(importInput).toBeEnabled()
	await importInput.setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	await expect(
		firstPage.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' }),
	).toBeVisible({ timeout: 20_000 })
	await expect(
		secondPage.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' }),
	).toBeVisible({ timeout: 20_000 })
	await expectSyncedImportedVideoProject(firstPage, uniqueTitle)
	await expectSyncedImportedVideoProject(secondPage, uniqueTitle)

	const secondTimeline = secondPage.getByRole('region', { name: 'Timeline', exact: true })
	await expect(secondTimeline.getByRole('button', { name: /fixture-video\.webm.*0\.0+s\s*\/\s*1\.0+s/i }).first()).toBeVisible({ timeout: 20_000 })
	await expect(secondTimeline.getByRole('button', { name: /Embedded audio.*0\.0+s\s*\/\s*1\.0+s/i }).first()).toBeVisible({ timeout: 20_000 })

	await firstPage.close()
	await secondPage.close()
})
