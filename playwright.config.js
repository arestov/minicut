import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests/integration',
	testIgnore: ['**/p2p-*.spec.ts'],
	fullyParallel: true,
	timeout: 30_000,
	globalSetup: './tests/integration/playwright-vite-global-setup.mjs',
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
