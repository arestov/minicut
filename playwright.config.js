import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests/integration',
	fullyParallel: true,
	timeout: 30_000,
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
	webServer: [
		{
			command: 'npm --prefix backend run dev:test',
			url: 'http://127.0.0.1:8787/api/health',
			reuseExistingServer: !process.env.CI,
			stdout: 'pipe',
			stderr: 'pipe',
		},
		{
			command: 'npm start',
			url: 'http://127.0.0.1:4174',
			reuseExistingServer: !process.env.CI,
			stdout: 'pipe',
			stderr: 'pipe',
		},
	],
})
