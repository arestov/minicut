import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createBunRuntimeEnvironment } from './bunRuntimeEnvironment.mjs'

// Opens a real GPUIX window and drives it through @gpuix/solid/automation
// (src/ui/gpuix/automation.smoke.ts). Run it serially, never in parallel with
// other window tests. GPUIX_BACKGROUND=1 (default here, set 0 to watch the window) opens
// the windows with focus: false so they do not steal focus. Bun comes from BUN_BIN or PATH.
const bun = process.env.BUN_BIN || 'bun'
const cwd = fileURLToPath(new URL('../src/ui/gpuix/', import.meta.url))

const result = spawnSync(bun, ['automation.smoke.ts'], { cwd, stdio: 'inherit', env: { ...createBunRuntimeEnvironment(), BUN_BIN: bun, GPUIX_BACKGROUND: process.env.GPUIX_BACKGROUND ?? "1" } })

if (result.error) {
	console.error(
		`Cannot run "${bun}": ${result.error.message}\n` +
			'Install Bun >= 1.4 and put it on PATH, or set BUN_BIN to the bun executable.',
	)
	process.exit(1)
}

process.exit(result.status ?? 1)
