import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { dktViteAliases } from './scripts/dktAliases.mjs'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	resolve: {
		alias: {
			'@dkt-react-sync': path.resolve(repoRoot, 'src/dkt-react-sync'),
			'@dkt-ui-sync': path.resolve(repoRoot, 'src/dkt-ui-sync'),
			'@video-editor': path.resolve(repoRoot, 'src/video-editor'),
			...dktViteAliases,
		},
	},
	test: {
		environment: 'node',
		fileParallelism: false,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: ['test/dkt-react-sync/**/*.contract.test.ts'],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
	},
})
