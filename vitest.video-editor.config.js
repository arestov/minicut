import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dktRoot = path.resolve(__dirname, 'tmp/dkt/js')
const dktProvodaRoot = path.resolve(__dirname, 'tmp/dkt/js/libs/provoda/provoda')

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
			dkt: dktProvodaRoot,
			'dkt-all': dktRoot,
		},
	},
	test: {
		globals: true,
		environment: 'jsdom',
		include: [
			'src/video-editor/**/*.test.ts',
			'src/video-editor/**/*.test.tsx',
			'src/dkt-react-sync/**/*.test.ts',
			'src/dkt-react-sync/**/*.test.tsx',
		],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
		setupFiles: ['./src/video-editor/tests/setup.ts'],
	},
})