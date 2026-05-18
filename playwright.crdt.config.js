import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests/integration',
	testMatch: ['**/crdt-*.spec.ts'],
	fullyParallel: false,
	workers: 1,
	timeout: 40_000,
	globalSetup: './tests/integration/playwright-crdt-global-setup.mjs',
	use: {
		baseURL: 'http://127.0.0.1:4176',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'crdt-ui-indexeddb',
			use: { browserName: 'chromium' },
		},
	],
})
