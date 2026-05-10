import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests/integration',
	testMatch: ['**/p2p-*.spec.ts'],
	fullyParallel: true,
	workers: Number(process.env.P2P_WORKERS ?? (process.env.CI ? 2 : 3)),
	timeout: 30_000,
	globalSetup: './tests/integration/playwright-p2p-global-setup.mjs',
	use: {
		baseURL: 'http://127.0.0.1:4174',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium' },
		},
	],
})
