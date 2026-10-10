import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createBunRuntimeEnvironment } from './bunRuntimeEnvironment.mjs'

// Runs a vitest config under the Bun runtime (`bun --bun`), so Node-targeted
// suites exercise DKT on Bun. Bun comes from BUN_BIN or PATH.
const bun = process.env.BUN_BIN || 'bun'
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const cwd = fileURLToPath(new URL('../', import.meta.url))

const result = spawnSync(bun, ['--bun', vitest, 'run', ...process.argv.slice(2)], {
	cwd,
	stdio: 'inherit',
	env: createBunRuntimeEnvironment(),
})

if (result.error) {
	console.error(
		`Cannot run "${bun}": ${result.error.message}\n` +
			'Install Bun >= 1.4 and put it on PATH, or set BUN_BIN to the bun executable.',
	)
	process.exit(1)
}

process.exit(result.status ?? 1)
