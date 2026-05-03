import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		include: [
			'src/video-editor/node/**/*.test.ts',
			'src/video-editor/worker/*contract.test.ts',
			'src/video-editor/worker/authorityRuntimeParity.test.ts',
			'src/video-editor/domain/protocolCompatibility.test.ts',
		],
		exclude: ['node_modules/**', 'dist*/**'],
	},
})
