import fs from 'node:fs'
import path from 'node:path'
import {
	clickButton,
	closeWindow,
	openTestWindow,
	registerSchemeBeforeReady,
	startTestDesktop,
	waitForConnectedWindows,
	waitForPageText,
	type Electron,
	type HarnessCtx,
} from './_harness/desktopDriver'

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
		const connected = listWindows(desktop)

		await clickButton(first.webContents, 'Video track')
		await waitForPageText(first.webContents, /3 tracks/)
		const secondText = await waitForPageText(second.webContents, /3 tracks/)

		const result = {
			connected,
			roomId: desktop.host.identity.roomId,
			secondSawEdit: /3 tracks/.test(secondText),
			deliveries,
		}
		await closeWindow(second)
		await closeWindow(first)
		await desktop.dispose()
		return result
	},

	/** Effects with two windows open: who receives export and playback requests. */
	async twoWindowEffects({ electron, ctx }: { electron: Electron; ctx: Ctx }) {
		const { desktop, deliveries, waitForDeliveries } = await startTestDesktop({ electron, ctx })
		const first = await openTestWindow(electron, ctx)
		await waitForPageText(first.webContents, /2 tracks/)
		const second = await openTestWindow(electron, ctx)
		await waitForPageText(second.webContents, /2 tracks/)
		const connected = listWindows(desktop)

		await clickButton(first.webContents, 'Add Text to Timeline')
		await waitForPageText(first.webContents, /0\.0s \/ 3\.0s/)
		await clickButton(first.webContents, 'Export')
		await waitForDeliveries('dkt:export-request', 1)
		const exportDeliveries = deliveries.filter((delivery) => delivery.type === 'dkt:export-request')

		await clickButton(first.webContents, 'Play')
		await waitForPageText(first.webContents, /Pause/)
		const playbackStarts = deliveries.filter(
			(delivery) => delivery.type === 'dkt:playback-run-request' && delivery.startsPlayback,
		)

		await closeWindow(second)
		await closeWindow(first)
		await desktop.dispose()
		return { connected, exportDeliveries, playbackStarts }
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
