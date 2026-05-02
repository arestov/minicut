import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const localSignalUrl = process.env.MINICUT_SIGNAL_URL?.trim() || 'http://127.0.0.1:8787'

const passthroughEnv = {
	...process.env,
	VITE_MINICUT_SIGNAL_URL: localSignalUrl,
}

if (process.env.MINICUT_TURN_URLS) {
	passthroughEnv.VITE_MINICUT_TURN_URLS = process.env.MINICUT_TURN_URLS
}
if (process.env.MINICUT_TURN_USERNAME) {
	passthroughEnv.VITE_MINICUT_TURN_USERNAME = process.env.MINICUT_TURN_USERNAME
}
if (process.env.MINICUT_TURN_CREDENTIAL) {
	passthroughEnv.VITE_MINICUT_TURN_CREDENTIAL = process.env.MINICUT_TURN_CREDENTIAL
}

const spawnProcess = (command, args, env = {}) => spawn(command, args, {
	stdio: 'inherit',
	shell: false,
	env: {
		...passthroughEnv,
		...env,
	},
})

const backend = spawnProcess(npmCommand, ['--prefix', 'backend', 'run', 'dev:test'])
const frontend = spawnProcess(npmCommand, ['run', 'start'])

const children = [backend, frontend]
let shuttingDown = false

const shutdown = (exitCode = 0) => {
	if (shuttingDown) {
		return
	}

	shuttingDown = true
	for (const child of children) {
		if (!child.killed) {
			child.kill('SIGTERM')
		}
	}
	process.exit(exitCode)
}

for (const child of children) {
	child.on('exit', (code, signal) => {
		if (shuttingDown) {
			return
		}

		if (signal) {
			shutdown(1)
			return
		}

		if (typeof code === 'number' && code !== 0) {
			shutdown(code)
		}
	})
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
