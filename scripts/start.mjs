import { spawn } from 'node:child_process'

const quoteWindowsArg = (value) => {
	const text = String(value)
	if (!/[\s"^&|<>]/.test(text)) {
		return text
	}

	return `"${text.replaceAll('"', '\\"')}"`
}

const spawnProcess = (command, args, env = {}) => {
	const inheritedEnv = {
		...process.env,
		...env,
	}

	if (process.platform === 'win32') {
		const quoted = [command, ...args]
			.map((value, index) => (index === 0 ? String(value) : quoteWindowsArg(value)))
			.join(' ')

		return spawn('cmd.exe', ['/d', '/s', '/c', quoted], {
			stdio: 'inherit',
			env: inheritedEnv,
		})
	}

	return spawn(command, args, {
		stdio: 'inherit',
		shell: false,
		env: inheritedEnv,
	})
}

const args = process.argv.slice(2)
const shouldRunFullStack = args.includes('dev:full')

const child = shouldRunFullStack
	? spawnProcess('node', ['./scripts/dev-full.mjs'])
	: spawnProcess('vite', ['--config', 'vite.video-editor.config.js', '--host', '127.0.0.1', '--port', '4174'])

let shuttingDown = false

const terminateProcessTree = (signal) => {
	if (shuttingDown) {
		return
	}
	shuttingDown = true

	if (!child.pid) {
		process.exit(0)
		return
	}

	if (process.platform === 'win32') {
		const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
			stdio: 'ignore',
		})
		killer.on('exit', () => process.exit(0))
		killer.on('error', () => process.exit(0))
		return
	}

	child.kill(signal)
}

process.on('SIGTERM', () => terminateProcessTree('SIGTERM'))
process.on('SIGINT', () => terminateProcessTree('SIGINT'))

child.on('exit', (code, signal) => {
	if (signal) {
		process.exit(1)
		return
	}

	process.exit(typeof code === 'number' ? code : 0)
})

child.on('error', (error) => {
	console.error(error)
	process.exit(1)
})
