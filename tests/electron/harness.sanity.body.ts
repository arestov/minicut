import fs from 'node:fs'
import path from 'node:path'

type Electron = typeof import('electron')
type Ctx = { userDataDir: string; params: { mode?: string } | null }

export const run = async ({ electron, ctx }: { electron: Electron; ctx: Ctx }) => {
	if (ctx.params?.mode === 'throw') {
		throw new Error('body failed on purpose')
	}
	if (ctx.params?.mode === 'hang') {
		await new Promise(() => undefined)
	}
	const userData = electron.app.getPath('userData')
	fs.writeFileSync(path.join(userData, 'marker.txt'), 'written by the body')
	return {
		isReady: electron.app.isReady(),
		electronVersion: process.versions.electron,
		userDataIsIsolated: path.resolve(userData) === path.resolve(ctx.userDataDir),
		windowCount: electron.BrowserWindow.getAllWindows().length,
	}
}
