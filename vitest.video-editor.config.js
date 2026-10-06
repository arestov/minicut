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
		threads: true,
		minWorkers: 1,
		maxWorkers: 2,
		fileParallelism: false,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: [
			'src/video-editor/**/*.test.ts',
			'src/video-editor/**/*.test.tsx',
			'src/dkt-react-sync/**/*.test.ts',
			'src/dkt-react-sync/**/*.test.tsx',
			'src/dkt-ui-sync/**/*.test.ts',
		],
		exclude: [
			'node_modules/**',
			'dist*/**',
			'tmp/dkt/**',
			'src/video-editor/dkt/models/**/*.test.ts',
			'src/video-editor/dkt/runtime/**/*.test.ts',
			'src/video-editor/p2p/**/*.test.ts',
		],
		setupFiles: ['./src/video-editor/tests/setup.ts'],
	},
})
