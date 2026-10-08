import { expect, test } from '@playwright/test'
import path from 'node:path'
import { waitForP2PDebugState } from './p2pTestHelpers'

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
	// The debug bridge is installed by a dynamic import after first render.
	await Promise.all([waitForP2PDebugState(firstPage), waitForP2PDebugState(secondPage)])

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

test('a page with an explicit room link stays in its own isolated room', async ({ context }) => {
	const defaultRoomPage = await context.newPage()
	const explicitRoomPage = await context.newPage()
	const explicitRoomId = `explicit-room-${Date.now()}`

	// An explicit link also stores its room as the "last room", so a no-hash page
	// opened at the same moment may legitimately pick it up. Resolve the default
	// room first; the explicit link must then stay in its own room regardless.
	await defaultRoomPage.goto('/')
	await expect(defaultRoomPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await explicitRoomPage.goto(`/#/${explicitRoomId}`)
	await expect(explicitRoomPage.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await Promise.all([waitForP2PDebugState(defaultRoomPage), waitForP2PDebugState(explicitRoomPage)])

	expect(new URL(explicitRoomPage.url()).hash).toBe(`#/${explicitRoomId}`)
	expect(new URL(defaultRoomPage.url()).hash).not.toBe(`#/${explicitRoomId}`)

	const defaultTitle = `DefaultRoom-${Date.now()}`
	const explicitTitle = `ExplicitRoom-${Date.now()}`
	await createProjectViaDebugBridge(defaultRoomPage, defaultTitle)
	await createProjectViaDebugBridge(explicitRoomPage, explicitTitle)
	await waitForRuntimeSettled(defaultRoomPage)
	await waitForRuntimeSettled(explicitRoomPage)

	// Each room only ever contains its own project: the other room's project
	// would have arrived over the shared CRDT room by now if the rooms were shared.
	await expect.poll(() => getProjectTitles(defaultRoomPage)).toContain(defaultTitle)
	await expect.poll(() => getProjectTitles(explicitRoomPage)).toContain(explicitTitle)
	expect(await getProjectTitles(defaultRoomPage)).not.toContain(explicitTitle)
	expect(await getProjectTitles(explicitRoomPage)).not.toContain(defaultTitle)

	await defaultRoomPage.close()
	await explicitRoomPage.close()
})
