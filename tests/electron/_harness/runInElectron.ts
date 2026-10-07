import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronBinary from 'electron'
// @ts-expect-error plain ESM script without type declarations
import { buildNodeEntry } from '../../../scripts/build-electron.mjs'

const harnessDir = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(harnessDir, '..', '..', '..')
const bundleRoot = path.join(repoRoot, 'dist-electron', 'test-bodies')
const RESULT_MARKER = '__MINICUT_RESULT__:'
const TMP_PREFIX = 'minicut-electron-'

export type RunInElectronOptions = {
	/** The whole run, including Electron start-up. */
	timeoutMs?: number
	/** Profile directory; defaults to a fresh temporary directory. */
	userDataDir?: string
	env?: Record<string, string>
	/** Passed to the body as ctx.params (JSON). */
	params?: unknown
}

/** Deletes a directory, retrying: Windows holds handles for a moment after exit. */
export const removeDirRetrying = (dir: string): void => {
	if (!dir || !fs.existsSync(dir)) {
		return
	}
	for (let attempt = 0; attempt < 8; attempt += 1) {
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
			return
		} catch (error) {
			if (attempt === 7) {
				console.warn(`[runInElectron] could not remove ${dir}: ${(error as Error).message}`)
			}
		}
	}
}

const sweepStaleTempDirs = (): void => {
	try {
		for (const name of fs.readdirSync(os.tmpdir())) {
			if (!name.startsWith(TMP_PREFIX)) continue
			const full = path.join(os.tmpdir(), name)
			if (Date.now() - fs.statSync(full).mtimeMs > 60 * 60 * 1000) {
				removeDirRetrying(full)
			}
		}
	} catch {
		// best effort
	}
}
let swept = false

const bundledBodies = new Map<string, Promise<string>>()

/** Bundles a TypeScript body (main-process code) into repoRoot/dist-electron/test-bodies. */
const bundleBody = (bodyPath: string): Promise<string> => {
	let bundled = bundledBodies.get(bodyPath)
	if (!bundled) {
		const outDir = path.join(bundleRoot, `${path.basename(bodyPath, path.extname(bodyPath))}-${randomUUID().slice(0, 8)}`)
		bundled = buildNodeEntry({
			entry: bodyPath,
			outDir,
			format: 'es',
			fileName: 'body.mjs',
			external: ['electron', 'classic-level'],
		}).then(() => path.join(outDir, 'body.mjs'))
		bundledBodies.set(bodyPath, bundled)
	}
	return bundled
}

const killProcessTree = (pid: number | undefined): void => {
	if (!pid) return
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
	} else {
		try {
			process.kill(pid, 'SIGKILL')
		} catch {
			// already gone
		}
	}
}

/**
 * Runs `run({ electron, ctx })` of a TypeScript body inside the main process
 * of a real Electron binary and returns its JSON result.
 * Serial by design: windows open in the interactive Windows session, so test
 * files must not run in parallel (see vitest.electron.config.js).
 */
export const runInElectron = async <Result = unknown>(
	bodyPath: string,
	options: RunInElectronOptions = {},
): Promise<Result> => {
	const { timeoutMs = 90_000, env: extraEnv = {}, params } = options
	if (!swept) {
		swept = true
		sweepStaleTempDirs()
	}
	const bundlePath = await bundleBody(bodyPath)
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX))
	const userDataDir = options.userDataDir ?? path.join(tmpDir, 'profile')
	fs.mkdirSync(userDataDir, { recursive: true })
	const ctxPath = path.join(tmpDir, 'ctx.json')
	fs.writeFileSync(
		ctxPath,
		JSON.stringify({
			tmpDir,
			userDataDir,
			repoRoot,
			distRoot: path.join(repoRoot, 'dist-electron'),
			params: params ?? null,
		}),
	)

	const env = { ...process.env, ...extraEnv, NODE_ENV: 'test' } as NodeJS.ProcessEnv
	delete env.ELECTRON_RUN_AS_NODE

	return new Promise<Result>((resolve, reject) => {
		const child = spawn(
			electronBinary as unknown as string,
			[path.join(harnessDir, 'host.cjs'), bundlePath, ctxPath],
			{ cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(timeoutMs) },
		)
		let stdout = ''
		let stderr = ''
		let settled = false
		const finish = (error: Error | null, value?: Result) => {
			if (settled) return
			settled = true
			killProcessTree(child.pid)
			removeDirRetrying(tmpDir)
			if (error) reject(error)
			else resolve(value as Result)
		}
		child.stdout.on('data', (chunk) => {
			stdout += String(chunk)
		})
		child.stderr.on('data', (chunk) => {
			stderr += String(chunk)
		})
		child.on('error', (error) => {
			if (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR') {
				finish(
					new Error(
						`runInElectron timed out after ${timeoutMs}ms
--- stdout ---
${stdout}
--- stderr ---
${stderr}`,
					),
				)
				return
			}
			finish(error)
		})
		child.on('close', (code, signal) => {
			const index = stdout.lastIndexOf(RESULT_MARKER)
			if (index === -1) {
				finish(
					new Error(
						`runInElectron: no result (exit=${code} signal=${signal})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
					),
				)
				return
			}
			const line = stdout.slice(index + RESULT_MARKER.length).split('\n', 1)[0]
			let payload: { ok: boolean; result?: Result; error?: string }
			try {
				payload = JSON.parse(line)
			} catch (error) {
				finish(new Error(`runInElectron: unreadable result: ${(error as Error).message}\n${line}`))
				return
			}
			if (!payload.ok) {
				finish(new Error(`runInElectron: body failed: ${payload.error}`))
				return
			}
			finish(null, payload.result as Result)
		})
	})
}

/** Removes bundled bodies; call once after the whole run. */
export const cleanupBundledBodies = (): void => {
	removeDirRetrying(bundleRoot)
}
