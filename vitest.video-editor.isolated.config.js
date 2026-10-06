import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { dktViteAliases } from './scripts/dktAliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
			...dktViteAliases,
		},
	},
	test: {
		globals: true,
		environment: 'jsdom',
		fileParallelism: false,
		maxWorkers: 1,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: ['src/video-editor/p2p/**/*.test.ts'],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
		setupFiles: ['./src/video-editor/tests/setup.ts'],
	},
})
