import { spawnSync } from 'node:child_process'

// Web/desktop parity suite: the shared scenario on the web app (Playwright) and on the real
// desktop host (bun test), then the comparison of both runs' artifacts (vitest).
// Usage: node scripts/run-web-desktop-parity.mjs [web] [desktop] [compare]   (default: all three)
// The desktop run needs Bun (BUN_BIN or PATH), see scripts/run-gpuix-tests.mjs.
const stages = {
	web: ['npx', ['playwright', 'test', 'tests/integration/web-desktop-scenario.spec.ts', '--reporter=line', '--workers=1']],
	desktop: [process.execPath, ['scripts/run-gpuix-tests.mjs', 'parity/desktopScenario.test.ts']],
	compare: ['npx', ['vitest', 'run', '--config', 'vitest.parity.config.js']],
}

const requested = process.argv.slice(2)
const unknown = requested.filter((name) => !(name in stages))
if (unknown.length > 0) {
	console.error(`Unknown stage ${unknown.join(', ')}; use ${Object.keys(stages).join(', ')}.`)
	process.exit(2)
}

for (const name of requested.length > 0 ? requested : Object.keys(stages)) {
	console.log(`\n== parity: ${name} ==`)
	const [command, args] = stages[name]
	const result = spawnSync(command, args, { stdio: 'inherit', shell: command === 'npx' })
	if (result.error) {
		console.error(`Cannot run ${command}: ${result.error.message}`)
		process.exit(1)
	}
	if (result.status !== 0) process.exit(result.status ?? 1)
}
