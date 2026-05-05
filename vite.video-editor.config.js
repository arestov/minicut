import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dktRoot = path.resolve(__dirname, 'tmp/dkt/js')
const dktProvodaRoot = path.resolve(__dirname, 'tmp/dkt/js/libs/provoda/provoda')

export default defineConfig({
	plugins: [react()],
	root: path.resolve(__dirname, 'src/video-editor'),
	resolve: {
		alias: {
			'@video-editor': path.resolve(__dirname, 'src/video-editor'),
			dkt: dktProvodaRoot,
			'dkt-all': dktRoot,
		},
	},
	build: {
		outDir: path.resolve(__dirname, 'dist-video-editor'),
		emptyOutDir: true,
	},
	server: {
		port: 4174,
	},
})
