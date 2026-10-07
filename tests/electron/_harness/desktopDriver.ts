import path from 'node:path'
import type { BrowserWindow, WebContents } from 'electron'
import { startDesktopApp, type DesktopApp } from '../../../src/video-editor/hosts/electron/main/desktopApp'
import { createEditorWindow } from '../../../src/video-editor/hosts/electron/main/editorWindow'
import { registerMiniCutScheme } from '../../../src/video-editor/hosts/electron/main/registerProtocol'
import { MINICUT_RENDERER_ENTRY_URL } from '../../../src/video-editor/hosts/electron/shared/ipcChannels'
import type { MiniCutDktTransportMessage } from '../../../src/video-editor/dkt/shared/messageTypes'

export type Electron = typeof import('electron')
export type HarnessCtx = {
	tmpDir: string
	userDataDir: string
	distRoot: string
	params: Record<string, unknown> | null
}

/** Records which window received which effect message. */
export type EffectDelivery = { sessionId: string; type: string; startsPlayback?: boolean }

/** Body hook: the minicut scheme must be privileged before the app is ready. */
export const registerSchemeBeforeReady = ({ electron }: { electron: Electron }): void => {
	registerMiniCutScheme(electron.protocol)
}

/**
 * Starts the real desktop composition (configuration B: media service in a
 * utility process, executors in main) on the test profile. Every runtime
 * message a window receives is recorded: effects that must stay in main show
 * up here only if they leak into a renderer.
 */
export const startTestDesktop = async ({
	electron,
	ctx,
}: {
	electron: Electron
	ctx: HarnessCtx
}): Promise<{
	desktop: DesktopApp
	deliveries: EffectDelivery[]
	/** Effects that had no owner (type -> reason). */
	dropped: { type: string; reason: string }[]
	exportDirectory: string
}> => {
	const deliveries: EffectDelivery[] = []
	const dropped: { type: string; reason: string }[] = []
	const exportDirectory = path.join(ctx.tmpDir, 'exports')
	const desktop = await startDesktopApp({
		profileDir: ctx.userDataDir,
		rendererDir: path.join(ctx.distRoot, 'renderer'),
		mediaServiceEntryPath: path.join(ctx.distRoot, 'utility', 'mediaService.mjs'),
		exportDirectory,
		electron: {
			ipcMain: electron.ipcMain,
			protocol: electron.protocol,
			MessageChannelMain: electron.MessageChannelMain,
			utilityProcess: electron.utilityProcess as never,
		},
		observeWindowMessages: (window, message) => {
			const typed = message as MiniCutDktTransportMessage
			const payload = (typed as { payload?: { run?: unknown } }).payload
			deliveries.push({
				sessionId: window.sessionId,
				type: typed.type,
				startsPlayback: Boolean(payload?.run),
			})
		},
		onEffectDropped: (type, reason) => dropped.push({ type, reason }),
	})
	return { desktop, deliveries, dropped, exportDirectory }
}

export const openTestWindow = (electron: Electron, ctx: HarnessCtx): Promise<BrowserWindow> =>
	createEditorWindow({
		BrowserWindow: electron.BrowserWindow,
		preloadPath: path.join(ctx.distRoot, 'preload', 'preload.cjs'),
		url: MINICUT_RENDERER_ENTRY_URL,
		show: false,
		backgroundThrottling: false,
	})

/**
 * Resolves with the page text once it matches. Event driven (a
 * MutationObserver in the page), no polling; the overall bound is the
 * timeout of runInElectron.
 */
export const waitForPageText = (webContents: WebContents, pattern: RegExp): Promise<string> =>
	webContents.executeJavaScript(`new Promise((resolve) => {
		const pattern = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)});
		const check = () => {
			const text = document.body ? document.body.innerText : '';
			if (pattern.test(text)) {
				observer.disconnect();
				resolve(text);
			}
		};
		const observer = new MutationObserver(check);
		observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
		check();
	})`)

export const clickButton = (webContents: WebContents, label: string): Promise<boolean> =>
	webContents.executeJavaScript(`(() => {
		const label = ${JSON.stringify(label)};
		const button = [...document.querySelectorAll('button')].find(
			(candidate) => (candidate.innerText || candidate.getAttribute('aria-label') || '').trim() === label,
		);
		if (!button) return false;
		button.click();
		return true;
	})()`)

/** Resolves when the window's renderer has gone away (closed or destroyed). */
export const closeWindow = (window: BrowserWindow): Promise<void> =>
	new Promise((resolve) => {
		if (window.isDestroyed()) {
			resolve()
			return
		}
		window.once('closed', () => resolve())
		window.destroy()
	})

/** Resolves when the number of windows connected to the runtime is `count`. */
export const waitForConnectedWindows = (desktop: DesktopApp, count: number): Promise<void> =>
	new Promise((resolve) => {
		const check = (): boolean => desktop.windows.getConnectedWindows().length === count
		if (check()) {
			resolve()
			return
		}
		const stop = desktop.windows.onConnectedWindowsChanged(() => {
			if (check()) {
				stop()
				resolve()
			}
		})
	})

/**
 * Picks files in a native file input the way a user would: the Chromium
 * input receives real, path-backed File objects (DOM.setFileInputFiles).
 */
export const pickFiles = async (
	webContents: WebContents,
	ariaLabel: string,
	paths: string[],
): Promise<void> => {
	const session = webContents.debugger
	if (!session.isAttached()) session.attach('1.3')
	await session.sendCommand('DOM.enable')
	const { root } = (await session.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } }
	const { nodeId } = (await session.sendCommand('DOM.querySelector', {
		nodeId: root.nodeId,
		selector: `input[aria-label="${ariaLabel}"]`,
	})) as { nodeId: number }
	if (!nodeId) throw new Error(`no file input labelled ${ariaLabel}`)
	await session.sendCommand('DOM.setFileInputFiles', { nodeId, files: paths })
}

/** Sources of the media elements of the page (`<video>`, `<audio>`, `<img>`). */
export const mediaSources = (webContents: WebContents): Promise<string[]> =>
	webContents.executeJavaScript(
		`[...document.querySelectorAll('video, audio, img')].map((element) => element.getAttribute('src') || '').filter(Boolean)`,
	)

/** Status and length of a ranged read of an asset URL, made from inside the page. */
export const fetchRange = (
	webContents: WebContents,
	url: string,
): Promise<{ status: number; bytes: number; contentRange: string | null }> =>
	webContents.executeJavaScript(`(async () => {
		const response = await fetch(${JSON.stringify(url)}, { headers: { Range: 'bytes=0-9' } });
		const buffer = await response.arrayBuffer();
		return { status: response.status, bytes: buffer.byteLength, contentRange: response.headers.get('content-range') };
	})()`)
