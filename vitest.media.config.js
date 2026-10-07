import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Media tests spawn ffmpeg/ffprobe and generate fixtures; run serially so that
// process-count and "no orphan process" assertions are deterministic.
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
		testTimeout: 60_000,
		include: ['src/video-editor/media/node/**/*.media.test.ts'],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/**'],
	},
})
