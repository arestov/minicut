/* eslint-disable no-console */
/*
  Electron main-process host for tests/electron.
  argv[2] = absolute path to a bundled test body module (ESM) exporting
            `run({ electron, ctx })` and optionally `beforeReady({ electron, ctx })`
  argv[3] = absolute path to a JSON file with the run context
  Prints one line: __MINICUT_RESULT__:{"ok":true,"result":...} or {"ok":false,"error":"..."}
*/
const electron = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { app } = electron
const RESULT_MARKER = '__MINICUT_RESULT__:'

const [, , modulePath, ctxPath] = process.argv
if (!modulePath || !ctxPath) {
	console.error('[electron-host] usage: host.cjs <body-module> <ctx.json>')
	process.exit(2)
}
const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'))

// Isolate profile and session data before anything reads app.getPath().
app.setPath('userData', ctx.userDataDir)
app.setPath('sessionData', path.join(ctx.tmpDir, 'session'))

// Bodies close windows on purpose; the host exits only after it has the result.
app.on('window-all-closed', () => {})

const sendResult = (payload) => {
	process.stdout.write(`${RESULT_MARKER}${JSON.stringify(payload)}\n`)
}
const fail = (error) => {
	const message = error && (error.stack || error.message) ? error.stack || error.message : String(error)
	console.error('[electron-host] failed', message)
	sendResult({ ok: false, error: message })
	app.exit(1)
}
process.on('unhandledRejection', fail)
process.on('uncaughtException', fail)

;(async () => {
	try {
		const body = await import(pathToFileURL(modulePath).href)
		const run = body.run ?? (body.default && body.default.run)
		if (typeof run !== 'function') {
			throw new Error(`test body ${modulePath} does not export run({ electron, ctx })`)
		}
		// Privileged schemes can only be registered before the app is ready.
		const beforeReady = body.beforeReady ?? (body.default && body.default.beforeReady)
		if (typeof beforeReady === 'function') {
			await beforeReady({ electron, ctx })
		}
		await app.whenReady()
		const result = await run({ electron, ctx })
		sendResult({ ok: true, result: result === undefined ? null : result })
		app.exit(0)
	} catch (error) {
		fail(error)
	}
})()
