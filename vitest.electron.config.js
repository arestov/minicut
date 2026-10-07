import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { dktViteAliases } from './scripts/dktAliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Real Electron processes and windows: slow, serial, one agent at a time.
// Not part of `npm test`; run with `npm run test:electron`.
export default defineConfig({
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
			...dktViteAliases,
		},
	},
	test: {
		globals: true,
		environment: 'node',
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 120_000,
		hookTimeout: 120_000,
		globalSetup: ['./tests/electron/_harness/globalSetup.ts'],
		include: ['tests/electron/**/*.test.ts'],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
	},
})
