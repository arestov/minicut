import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const defaultBackendSignalUrl = 'https://minicut-backend.gleb-arestov.workers.dev'

const signalUrl = process.env.MINICUT_SIGNAL_URL?.trim()
	|| process.env.VITE_MINICUT_SIGNAL_URL?.trim()
	|| defaultBackendSignalUrl

const buildEnv = {
	...process.env,
	VITE_MINICUT_SIGNAL_URL: signalUrl,
}

if (process.env.MINICUT_TURN_URLS || process.env.VITE_MINICUT_TURN_URLS) {
	buildEnv.VITE_MINICUT_TURN_URLS = process.env.VITE_MINICUT_TURN_URLS || process.env.MINICUT_TURN_URLS || ''
}
if (process.env.MINICUT_TURN_USERNAME || process.env.VITE_MINICUT_TURN_USERNAME) {
	buildEnv.VITE_MINICUT_TURN_USERNAME = process.env.VITE_MINICUT_TURN_USERNAME || process.env.MINICUT_TURN_USERNAME || ''
}
if (process.env.MINICUT_TURN_CREDENTIAL || process.env.VITE_MINICUT_TURN_CREDENTIAL) {
	buildEnv.VITE_MINICUT_TURN_CREDENTIAL = process.env.VITE_MINICUT_TURN_CREDENTIAL || process.env.MINICUT_TURN_CREDENTIAL || ''
}

const run = (command, args, env = {}) => new Promise((resolve, reject) => {
	const child = spawn(command, args, {
		stdio: 'inherit',
		shell: false,
		env: {
			...buildEnv,
			...env,
		},
	})

	child.on('error', reject)
	child.on('exit', (code, signal) => {
		if (signal) {
			reject(new Error(`Process terminated by ${signal}`))
			return
		}

		if (code === 0) {
			resolve(undefined)
			return
		}

		reject(new Error(`Command failed with exit code ${code ?? 1}`))
	})
})

console.log(`Building frontend with signalUrl=${signalUrl}`)
await run(npmCommand, ['run', 'video-editor:build'])
await run(npxCommand, ['--yes', 'wrangler@4', 'pages', 'deploy', 'dist-video-editor', '--project-name', 'minicut-video-editor'])
