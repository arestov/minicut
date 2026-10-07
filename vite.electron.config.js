import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { dktViteAliases } from './scripts/dktAliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Renderer bundle of the Electron host. Main and preload are built by
// scripts/build-electron.mjs.
export default defineConfig({
	plugins: [react()],
	root: path.resolve(__dirname, 'src/video-editor/hosts/electron/renderer'),
	base: './',
	publicDir: false,
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
			...dktViteAliases,
		},
	},
	build: {
		outDir: path.resolve(__dirname, 'dist-electron/renderer'),
		emptyOutDir: true,
	},
	server: {
		port: 4175,
	},
})
