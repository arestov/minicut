import fs from 'node:fs'
import path from 'node:path'
import {
	clickButton,
	closeWindow,
	fetchRange,
	mediaSources,
	openTestWindow,
	pickFiles,
	registerSchemeBeforeReady,
	startTestDesktop,
	waitForButtonEnabled,
	waitForConnectedWindows,
	waitForPageText,
	type Electron,
	type HarnessCtx,
} from './_harness/desktopDriver'

import { describeStartupFailure } from '../../src/video-editor/hosts/electron/main/startupFailure'

export const beforeReady = registerSchemeBeforeReady

type Ctx = HarnessCtx

const readProfileIds = (ctx: Ctx) => {
	const metadata = JSON.parse(
		fs.readFileSync(path.join(ctx.userDataDir, 'minicut-profile.json'), 'utf8'),
	) as { roomId: string; localIdentity: string }
	return { roomId: metadata.roomId, localIdentity: metadata.localIdentity }
}

const listWindows = (desktop: Awaited<ReturnType<typeof startTestDesktop>>['desktop']) =>
	desktop.windows.getConnectedWindows().map((window) => ({
		sessionId: window.sessionId,
		webContentsId: window.webContentsId,
	}))

const scenarios = {
	/** First launch: edit through the window, then shut the app down cleanly. */
	async editAndQuit({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop } = await startTestDesktop({ electron, ctx })
		const window = await openTestWindow(electron, ctx)
		await waitForPageText(window.webContents, /2 tracks/)
		const clicked = await clickButton(window.webContents, 'Video track')
		await waitForPageText(window.webContents, /3 tracks/)
		const connected = listWindows(desktop)
		const peerId = desktop.host.identity.peerId
		await desktop.dispose()
		return { clicked, connected, peerId, ...readProfileIds(ctx) }
	},

	/** Second launch on the same profile: the edit must come back without any action. */
	async restore({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop } = await startTestDesktop({ electron, ctx })
		const window = await openTestWindow(electron, ctx)
		const text = await waitForPageText(window.webContents, /3 tracks/)
		const peerId = desktop.host.identity.peerId
		await desktop.dispose()
		return { text, peerId, ...readProfileIds(ctx) }
	},

	/** Two windows on one runtime: shared room, separate sessions, shared changes. */
	async twoWindows({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop, deliveries } = await startTestDesktop({ electron, ctx })
		const first = await openTestWindow(electron, ctx)
		await waitForPageText(first.webContents, /2 tracks/)
		const second = await openTestWindow(electron, ctx)
		await waitForPageText(second.webContents, /2 tracks/)
		// The second window opens the last active project: export is enabled there.
		const secondExportEnabled = await waitForButtonEnabled(second.webContents, 'Export')
		const connected = listWindows(desktop)

		await clickButton(first.webContents, 'Video track')
		await waitForPageText(first.webContents, /3 tracks/)
		const secondText = await waitForPageText(second.webContents, /3 tracks/)

		const result = {
			connected,
			roomId: desktop.host.identity.roomId,
			secondSawEdit: /3 tracks/.test(secondText),
			secondExportEnabled,
			deliveries,
		}
		await closeWindow(second)
		await closeWindow(first)
		await desktop.dispose()
		return result
	},

	/** Effects with two windows open: export runs in main, playback in the starting window. */
	async twoWindowEffects({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop, deliveries } = await startTestDesktop({ electron, ctx })
		const first = await openTestWindow(electron, ctx)
		await waitForPageText(first.webContents, /2 tracks/)
		const second = await openTestWindow(electron, ctx)
		await waitForPageText(second.webContents, /2 tracks/)
		const connected = listWindows(desktop)

		await clickButton(first.webContents, 'Add Text to Timeline')
		await waitForPageText(first.webContents, /0\.0s \/ 3\.0s/)
		await clickButton(first.webContents, 'Export')
		// The media service in main answers: a file or a typed failure, shown in the window that asked.
		const exportStatus = await waitForPageText(first.webContents, /Export (ready|failed)/)
		const hostOnly = new Set([
			'dkt:export-request',
			'dkt:export-cancel-request',
			'dkt:import-files-request',
			'dkt:media-recovery-request',
		])
		const exportDeliveries = deliveries.filter((delivery) => hostOnly.has(delivery.type))

		await clickButton(first.webContents, 'Play')
		await waitForPageText(first.webContents, /Pause/)
		const playbackStarts = deliveries.filter(
			(delivery) => delivery.type === 'dkt:playback-run-request' && delivery.startsPlayback,
		)

		await closeWindow(second)
		await closeWindow(first)
		await desktop.dispose()
		return { connected, exportDeliveries, playbackStarts, exportStatus: /Export (ready|failed)[^\n]*/.exec(exportStatus)?.[0] ?? null }
	},

	/**
	 * Import a file through the window's native input, export it, quit.
	 * Everything slow ran in the media service; the window only saw the outcomes.
	 */
	async importAndExport({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const media = String(ctx.params?.media)
		const { desktop, deliveries, dropped, exportDirectory } = await startTestDesktop({ electron, ctx })
		const window = await openTestWindow(electron, ctx)
		await waitForPageText(window.webContents, /2 tracks/)

		await pickFiles(window.webContents, 'Import media files', [media])
		await waitForPageText(window.webContents, new RegExp(path.basename(media).replace('.', '\\.')))
		const sources = await mediaSources(window.webContents)
		const assetUrl = sources.find((source) => source.startsWith('/asset/')) ?? null
		const range = assetUrl ? await fetchRange(window.webContents, assetUrl) : null
		const assets = desktop.assets.list()

		await clickButton(window.webContents, 'Export')
		const exportStatus = await waitForPageText(window.webContents, /Export (ready|failed)[^\n]*/)
		const exportedFiles = fs.existsSync(exportDirectory) ? fs.readdirSync(exportDirectory) : []
		const hostOnly = ['dkt:export-request', 'dkt:import-files-request', 'dkt:media-recovery-request']
		const leaked = deliveries.filter((delivery) => hostOnly.includes(delivery.type))

		await closeWindow(window)
		await desktop.dispose()
		return {
			assetUrl,
			range,
			assets: assets.map((asset) => asset.path),
			exportStatus: /Export (ready|failed)[^\n]*/.exec(exportStatus)?.[0] ?? null,
			exportedFiles,
			exportDirectory,
			leaked,
			dropped,
		}
	},

	/** Second launch on the same profile: the media comes back from the registry by the same id. */
	async restoreMedia({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const media = String(ctx.params?.media)
		const { desktop, deliveries } = await startTestDesktop({ electron, ctx })
		const window = await openTestWindow(electron, ctx)
		await waitForPageText(window.webContents, new RegExp(path.basename(media).replace('.', '\\.')))
		const sources = await mediaSources(window.webContents)
		const assetUrl = sources.find((source) => source.startsWith('/asset/')) ?? null
		const range = assetUrl ? await fetchRange(window.webContents, assetUrl) : null
		const text = await waitForPageText(window.webContents, /./)
		const hostOnly = ['dkt:export-request', 'dkt:import-files-request', 'dkt:media-recovery-request']
		const leaked = deliveries.filter((delivery) => hostOnly.includes(delivery.type))
		const assets = desktop.assets.list().map((asset) => asset.path)
		await closeWindow(window)
		await desktop.dispose()
		return { assetUrl, range, assets, leaked, mentionsMissing: /missing|unavailable|relink/i.test(text) }
	},

	/** A second app on the profile of a running one fails with the typed database error. */
	async profileLocked({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop } = await startTestDesktop({ electron, ctx })
		let failure: { name: string; message: string; locked: boolean; title: string } | null = null
		try {
			const second = await startTestDesktop({ electron, ctx })
			await second.desktop.dispose()
		} catch (error) {
			failure = {
				name: (error as Error).name,
				message: (error as Error).message,
				locked: Boolean((error as { locked?: boolean }).locked),
				title: describeStartupFailure(error, ctx.userDataDir).title,
			}
		}
		await desktop.dispose()
		return { failure }
	},

	/** A reload keeps the window mapping and never adds a second connection. */
	async reload({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop } = await startTestDesktop({ electron, ctx })
		const window = await openTestWindow(electron, ctx)
		await waitForPageText(window.webContents, /2 tracks/)
		const before = listWindows(desktop)
		const connectionCounts: number[] = []
		desktop.windows.onConnectedWindowsChanged(() => {
			connectionCounts.push(desktop.windows.getConnectedWindows().length)
		})

		const reloaded = new Promise<void>((resolve) =>
			window.webContents.once('did-finish-load', () => resolve()),
		)
		window.webContents.reload()
		await reloaded
		await waitForPageText(window.webContents, /2 tracks/)
		const after = listWindows(desktop)

		await closeWindow(window)
		await waitForConnectedWindows(desktop, 0)
		const afterClose = listWindows(desktop)
		await desktop.dispose()
		return { before, after, afterClose, connectionCounts }
	},
}

export const run = async ({ electron, ctx }: { electron: Electron; ctx: Ctx }) => {
	const name = String(ctx.params?.scenario)
	const scenario = (scenarios as Record<string, typeof scenarios.editAndQuit>)[name]
	if (!scenario) {
		throw new Error(`unknown scenario ${name}`)
	}
	return scenario({ electron, ctx })
}
