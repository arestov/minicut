import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { dktViteAliases } from './scripts/dktAliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))


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
		fileParallelism: true,
		maxWorkers: 4,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: [
			'src/video-editor/node/**/*.test.ts',
			'src/video-editor/media/node/**/*.test.ts',
			'src/video-editor/adapters/node/**/*.test.ts',
			'src/video-editor/worker/*contract.test.ts',
			'src/video-editor/worker/authorityRuntimeParity.test.ts',
			'src/video-editor/domain/protocolCompatibility.test.ts',
			'src/video-editor/dkt/models/**/*.test.ts',
			'src/video-editor/dkt/runtime/**/*.test.ts',
		],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**', 'src/video-editor/media/node/**/*.media.test.ts'],
	},
})
