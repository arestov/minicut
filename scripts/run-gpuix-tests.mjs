import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// bun test only reads bunfig.toml from its cwd (and ignores --config), so the
// Solid tests run from src/ui/gpuix. Bun comes from BUN_BIN or PATH.
const bun = process.env.BUN_BIN || 'bun'
const cwd = fileURLToPath(new URL('../src/ui/gpuix/', import.meta.url))

const result = spawnSync(bun, ['test', ...process.argv.slice(2)], { cwd, stdio: 'inherit' })

if (result.error) {
	console.error(
		`Cannot run "${bun}": ${result.error.message}\n` +
			'Install Bun >= 1.4 and put it on PATH, or set BUN_BIN to the bun executable.',
	)
	process.exit(1)
}

process.exit(result.status ?? 1)
