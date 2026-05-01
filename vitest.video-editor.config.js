import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
		},
	},
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['src/video-editor/**/*.test.ts', 'src/video-editor/**/*.test.tsx'],
		exclude: ['node_modules/**', 'dist*/**'],
		setupFiles: ['./src/video-editor/tests/setup.ts'],
	},
})