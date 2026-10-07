import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

export const fixturePath = (name: string): string => {
	const dir = process.env.MINICUT_ELECTRON_UI_FIXTURES
	if (!dir) {
		throw new Error('MINICUT_ELECTRON_UI_FIXTURES is not set (global setup did not run)')
	}
	return path.join(dir, name)
}

export type AssetRequest = { status: number; range: string | null; resourceType: string }

export type LaunchedMiniCut = {
	app: ElectronApplication
	page: Page
	/** Root of everything this launch owns: workspace profile, Chromium data, exports. */
	userDataDir: string
	/** Where the app writes finished exports. */
	exportDir: string
	/** Requests the renderer made to the asset protocol, observed in main. */
	assetRequests(): Promise<AssetRequest[]>
	/** Closes the app and removes the profile unless the caller owns it. */
	close(): Promise<void>
}

const removeDir = (dir: string) => {
	fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
}

/**
 * Starts the built desktop app on a throwaway profile. The workspace profile
 * (shared with the GPUIX app), Chromium's data and the export folder all live
 * under `userDataDir`, so a launch never touches a real profile.
 */
export const launchMiniCut = async (
	options: { userDataDir?: string } = {},
): Promise<LaunchedMiniCut> => {
	const ownsProfile = !options.userDataDir
	const userDataDir =
		options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'minicut-electron-ui-'))
	const exportDir = path.join(userDataDir, 'exports')
	const app = await electron.launch({
		args: [path.join(repoRoot, 'dist-electron', 'main', 'main.mjs')],
		cwd: repoRoot,
		env: {
			...(process.env as Record<string, string>),
			MINICUT_PROFILE_DIR: path.join(userDataDir, 'profile'),
			MINICUT_USER_DATA_DIR: path.join(userDataDir, 'chromium'),
			MINICUT_EXPORT_DIR: exportDir,
		},
	})
	try {
		await app.evaluate(({ session }) => {
			const target = globalThis as unknown as {
				__assetRequests: { status: number; range: string | null; resourceType: string }[]
			}
			target.__assetRequests = []
			const ranges = new Map<number, string | null>()
			session.defaultSession.webRequest.onBeforeSendHeaders(
				{ urls: ['minicut://*/asset/*'] },
				(details, callback) => {
					ranges.set(details.id, details.requestHeaders.Range ?? null)
					callback({ requestHeaders: details.requestHeaders })
				},
			)
			session.defaultSession.webRequest.onCompleted(
				{ urls: ['minicut://*/asset/*'] },
				(details) => {
					target.__assetRequests.push({
						status: details.statusCode,
						range: ranges.get(details.id) ?? null,
						resourceType: details.resourceType,
					})
				},
			)
		})
		const page = await app.firstWindow()
		await page.getByRole('button', { name: 'Video track' }).waitFor()
		return {
			app,
			page,
			userDataDir,
			exportDir,
			assetRequests: () =>
				app.evaluate(
					() => (globalThis as unknown as { __assetRequests: AssetRequest[] }).__assetRequests,
				),
			async close() {
				const processHandle = app.process()
				await app.close().catch(() => undefined)
				if (processHandle.exitCode === null) {
					processHandle.kill()
				}
				if (ownsProfile) {
					removeDir(userDataDir)
				}
			},
		}
	} catch (error) {
		await app.close().catch(() => undefined)
		if (ownsProfile) {
			removeDir(userDataDir)
		}
		throw error
	}
}
