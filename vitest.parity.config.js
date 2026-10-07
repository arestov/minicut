import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The web/desktop comparison reads the artifacts both platform runs wrote to tmp/parity and
// spawns ffmpeg/ffprobe; run it through `npm run test:parity` (it needs the two runs first).
export default defineConfig({
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		fileParallelism: false,
		hookTimeout: 120_000,
		testTimeout: 180_000,
		include: ['tests/parity/*.compare.test.ts'],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/**'],
	},
})
