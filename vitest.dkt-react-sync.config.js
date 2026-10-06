import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const dktRoot = path.resolve(repoRoot, 'tmp/dkt/js')
const dktProvodaRoot = path.resolve(repoRoot, 'tmp/dkt/js/libs/provoda/provoda')

export default defineConfig({
	resolve: {
		alias: {
			'@dkt-react-sync': path.resolve(repoRoot, 'src/dkt-react-sync'),
			'@dkt-ui-sync': path.resolve(repoRoot, 'src/dkt-ui-sync'),
			'@video-editor': path.resolve(repoRoot, 'src/video-editor'),
			dkt: dktProvodaRoot,
			'dkt-all': dktRoot,
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
