import { spawn } from 'node:child_process'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const quoteWindowsArg = (value) => {
	const text = String(value)
	if (!/[\s"^&|<>]/.test(text)) {
		return text
	}

	return `"${text.replaceAll('"', '\\"')}"`
}

const spawnProcess = (command, args, env = {}) => {
	if (process.platform === 'win32') {
		const quoted = [command, ...args]
			.map((value, index) => (index === 0 ? String(value) : quoteWindowsArg(value)))
			.join(' ')

		return spawn('cmd.exe', ['/d', '/s', '/c', quoted], {
			stdio: 'inherit',
			env: {
				...process.env,
				...env,
			},
		})
	}

	return spawn(command, args, {
		stdio: 'inherit',
		shell: false,
		env: {
			...process.env,
			...env,
		},
	})
}

const run = (command, args, env = {}) => new Promise((resolve, reject) => {
	const child = spawnProcess(command, args, env)

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

const copyStructureSnapshot = async () => {
	const snapshotOutDir = path.resolve('dist-video-editor/structure-graph-viewer/snapshot')
	await mkdir(snapshotOutDir, { recursive: true })
	await copyFile(
		path.resolve('app-structure.snapshot/core.json'),
		path.join(snapshotOutDir, 'core.json'),
	)
	await copyFile(
		path.resolve('app-structure.snapshot/derived.json'),
		path.join(snapshotOutDir, 'derived.json'),
	)
}

const verifyFrontendArtifact = async () => {
	const requiredFiles = [
		'dist-video-editor/index.html',
		'dist-video-editor/structure-graph-viewer/index.html',
		'dist-video-editor/structure-graph-viewer/snapshot/core.json',
		'dist-video-editor/structure-graph-viewer/snapshot/derived.json',
	]

	for (const file of requiredFiles) {
		const result = await stat(path.resolve(file))
		if (!result.isFile()) {
			throw new Error(`Expected deploy artifact file is not a file: ${file}`)
		}
		console.log(`[frontend-artifact] ${file} (${result.size} bytes)`)
	}
}

await run(npmCommand, ['run', 'video-editor:build:app'])
await run(npmCommand, ['run', 'structure:snapshot'])
await run(npmCommand, ['--prefix', './dev/structure-graph-viewer', 'run', 'build'])
await copyStructureSnapshot()
await verifyFrontendArtifact()
