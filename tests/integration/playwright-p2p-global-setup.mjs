import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const backendHealthUrl = 'http://127.0.0.1:8787/api/health'
const signalUrl = process.env.MINICUT_SIGNAL_URL?.trim() || 'http://127.0.0.1:8787'

const quoteWindowsArg = (value) => {
	const text = String(value)
	if (!/[\s"^&|<>]/.test(text)) {
		return text
	}

	return `"${text.replaceAll('"', '\\"')}"`
}

const isBackendAvailable = async () => {
	try {
		const response = await fetch(backendHealthUrl)
		return response.ok
	} catch {
		return false
	}
}

const waitForBackend = async (timeoutMs = 30_000) => {
	const startedAt = Date.now()
	let lastError = null

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(backendHealthUrl)
			if (response.ok) {
				return
			}
			lastError = new Error(`Backend health returned HTTP ${response.status}`)
		} catch (error) {
			lastError = error
		}

		await new Promise((resolve) => setTimeout(resolve, 250))
	}

	throw lastError ?? new Error('Timed out waiting for p2p backend')
}

const spawnBackend = () => {
	if (process.platform === 'win32') {
		const command = ['npm', '--prefix', 'backend', 'run', 'dev:test']
			.map((value, index) => (index === 0 ? value : quoteWindowsArg(value)))
			.join(' ')

		return spawn('cmd.exe', ['/d', '/s', '/c', command], {
			cwd: repoRoot,
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
	}

	return spawn('npm', ['--prefix', 'backend', 'run', 'dev:test'], {
		cwd: repoRoot,
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
}

const terminateProcessTree = async (child) => {
	if (!child?.pid) {
		return
	}

	if (process.platform === 'win32') {
		await new Promise((resolve) => {
			const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
				stdio: 'ignore',
			})
			const timer = setTimeout(resolve, 2_000)
			killer.on('exit', () => {
				clearTimeout(timer)
				resolve()
			})
			killer.on('error', () => {
				clearTimeout(timer)
				resolve()
			})
		})
		return
	}

	child.kill('SIGTERM')
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			resolve()
		}, 2_000)
		child.once('exit', () => {
			clearTimeout(timer)
			resolve()
		})
	})
}

export default async function setupP2PServers() {
	process.env.VITE_MINICUT_SIGNAL_URL = signalUrl

	const shouldReuseBackend = !process.env.CI && await isBackendAvailable()
	const backend = shouldReuseBackend ? null : spawnBackend()
	if (backend) {
		backend.stdout.on('data', () => undefined)
		backend.stderr.on('data', () => undefined)
		await waitForBackend()
	}

	const frontend = await createServer({
		configFile: path.join(repoRoot, 'vite.video-editor.config.js'),
		server: {
			host: '127.0.0.1',
			port: 4174,
			strictPort: true,
		},
	})
	await frontend.listen()

	return async () => {
		await frontend.close()
		await terminateProcessTree(backend)
	}
}
