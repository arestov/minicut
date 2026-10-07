import path from 'node:path'
import type { BrowserWindow, WebContents } from 'electron'
import { startDesktopApp, type DesktopApp } from '../../../src/video-editor/hosts/electron/main/desktopApp'
import { createWindowExecutorEffectInterfaces } from '../../../src/video-editor/hosts/electron/main/createWindowExecutorEffectInterfaces'
import { createEditorWindow } from '../../../src/video-editor/hosts/electron/main/editorWindow'
import { registerMiniCutScheme } from '../../../src/video-editor/hosts/electron/main/registerProtocol'
import { MINICUT_RENDERER_ENTRY_URL } from '../../../src/video-editor/hosts/electron/shared/ipcChannels'
import type { MiniCutDktTransportMessage } from '../../../src/video-editor/dkt/shared/messageTypes'

export type Electron = typeof import('electron')
export type HarnessCtx = { userDataDir: string; distRoot: string; params: Record<string, unknown> | null }

/** Records which window received which effect message. */
export type EffectDelivery = { sessionId: string; type: string; startsPlayback?: boolean }

/** Body hook: the minicut scheme must be privileged before the app is ready. */
export const registerSchemeBeforeReady = ({ electron }: { electron: Electron }): void => {
	registerMiniCutScheme(electron.protocol)
}

/**
 * Starts the real desktop composition (configuration A routing) on the
 * test profile. Every effect message is recorded with its target window
 * before being delivered unchanged.
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
	/** Resolves once at least `count` effect messages of this type have been delivered (or dropped). */
	waitForDeliveries(type: string, count: number): Promise<void>
}> => {
	const deliveries: EffectDelivery[] = []
	const countOf = (type: string) => deliveries.filter((delivery) => delivery.type === type).length
	const deliveryWaiters = new Set<{ type: string; count: number; resolve: () => void }>()
	const record = (delivery: EffectDelivery) => {
		deliveries.push(delivery)
		for (const waiter of [...deliveryWaiters]) {
			if (countOf(waiter.type) >= waiter.count) {
				deliveryWaiters.delete(waiter)
				waiter.resolve()
			}
		}
	}
	let desktop: DesktopApp | null = null
	type Connected = ReturnType<DesktopApp['windows']['getConnectedWindows']>[number]
	const spy = (window: Connected) => ({
		rootNodeId: window.rootNodeId,
		transport: {
			send(message: MiniCutDktTransportMessage) {
				const payload = (message as { payload?: { run?: unknown } }).payload
				record({
					sessionId: window.sessionId,
					type: message.type,
					startsPlayback: Boolean(payload?.run),
				})
				window.transport.send(message)
			},
		},
	})
	const effectInterfaces = createWindowExecutorEffectInterfaces({
		getWindows: () => (desktop?.windows.getConnectedWindows() ?? []).map(spy),
		claimImportWindow: (handleId) => {
			const window = desktop?.windows.claimImportWindow(handleId)
			return window ? spy(window) : null
		},
		onDropped: (type) => record({ sessionId: '(none)', type }),
	})
	desktop = await startDesktopApp({
		profileDir: ctx.userDataDir,
		rendererDir: path.join(ctx.distRoot, 'renderer'),
		electron: {
			ipcMain: electron.ipcMain,
			protocol: electron.protocol,
			MessageChannelMain: electron.MessageChannelMain,
		},
		effectInterfaces,
	})
	return {
		desktop,
		deliveries,
		waitForDeliveries: (type, count) =>
			new Promise((resolve) => {
				if (countOf(type) >= count) {
					resolve()
					return
				}
				deliveryWaiters.add({ type, count, resolve })
			}),
	}
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
