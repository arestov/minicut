import { expect, test } from '@playwright/test'
import path from 'node:path'

const enableDebugBridge = async (page: import('@playwright/test').Page) => {
	await page.addInitScript(() => {
		;(window as Window & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean }).__MINICUT_ENABLE_DEBUG_BRIDGE__ = true
	})
}

const waitForDebugBridge = async (page: import('@playwright/test').Page) => {
	await page.waitForFunction(() => window.__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true)
}

const createProjectFromMenu = async (page: import('@playwright/test').Page) => {
	await page.getByRole('button', { name: 'New project' }).click()
	await expect(page.getByLabel('Media bin')).not.toContainText('No active project.')
}

const importFixtureVideo = async (page: import('@playwright/test').Page) => {
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
	await expect(page.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible()
}

test.describe('CRDT conflict UX', () => {
	test('shows structural conflict actions in the real editor shell', async ({ page }) => {
		await enableDebugBridge(page)
		await page.goto('/')
		await waitForDebugBridge(page)
		await createProjectFromMenu(page)
		await importFixtureVideo(page)

		const fixture = await page.evaluate(async () => {
			const debug = window.__MINICUT_P2P_DEBUG__
			if (!debug?.injectFirstClipConflictTesting) {
				throw new Error('MiniCut conflict fixture injector is unavailable')
			}
			return await debug.injectFirstClipConflictTesting({
				kind: 'structural_delete_with_concurrent_activity',
				scope: 'timelineMembership',
				summary: 'Remote delete conflicts with local effect edit',
			})
		})

		const timeline = page.getByRole('region', { name: 'Timeline', exact: true })
		const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
		const badge = clip.getByRole('button', { name: '1 open conflict' })
		await expect(badge).toBeVisible()
		await badge.evaluate((element) => (element as HTMLButtonElement).click())

		const inspector = page.getByRole('region', { name: 'Conflict inspector' })
		await expect(inspector.getByText('Remote delete conflicts with local effect edit')).toBeVisible()
		await expect(inspector.getByText('Delete conflict · timelineMembership')).toBeVisible()
		await expect(inspector.getByRole('button', { name: 'Keep local' })).toBeVisible()
		await expect(inspector.getByRole('button', { name: 'Accept delete' })).toBeVisible()
		await expect(inspector.getByRole('button', { name: 'Restore' })).toBeVisible()

		await inspector.getByRole('button', { name: 'Keep local' }).click()
		await expect(inspector.getByText('Remote delete conflicts with local effect edit')).toBeVisible()
		expect(fixture.conflictId).toContain('structural:playwright')
	})
})
