import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const childEnv = {
	...process.env,
	MINICUT_REPRO_HEADLESS: process.env.MINICUT_REPRO_HEADLESS ?? '0',
	MINICUT_REPRO_KEEP_OPEN: process.env.MINICUT_REPRO_KEEP_OPEN ?? '1',
	MINICUT_REPRO_OPEN_CONFLICT: process.env.MINICUT_REPRO_OPEN_CONFLICT ?? '1',
	MINICUT_REPRO_URL: process.env.MINICUT_REPRO_URL ?? 'http://127.0.0.1:4176',
}

process.stdout.write(
	[
		'[visible-user-p2p] Delegating to the CRDT browser harness scenario.',
		'[visible-user-p2p] This path uses two real browser profiles, a node CRDT broker, network partition, real UI drags, and Project review.',
		'[visible-user-p2p] Start the frontend with VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS=1 on MINICUT_REPRO_URL, default http://127.0.0.1:4176.',
		'',
	].join('\n'),
)

const child = spawn(
	process.execPath,
	[path.join(repoRoot, 'scripts', 'repro-visible-browser-maelstrom-conflict.mjs')],
	{
		cwd: repoRoot,
		env: childEnv,
		stdio: 'inherit',
	},
)

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal)
		return
	}
	process.exitCode = code ?? 1
})
