import { defineConfig } from '@playwright/test'

// Real Electron renderer scenarios (import, export, preview seek) against the
// built desktop app. Serial: windows open in the interactive session and must
// not compete. Run with `npm run test:electron:ui`.
export default defineConfig({
	testDir: './tests/electron-ui',
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 20_000 },
	reporter: 'line',
	globalSetup: './tests/electron-ui/globalSetup.mjs',
	use: {
		trace: 'off',
		screenshot: 'only-on-failure',
	},
})
