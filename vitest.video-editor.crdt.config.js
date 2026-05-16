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
		threads: true,
		minWorkers: 1,
		maxWorkers: 2,
		fileParallelism: false,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: [
			'src/video-editor/dkt/models/semantic-graph-declarations.test.ts',
			'src/video-editor/dkt/models/crdt-field-coverage.test.ts',
			'src/video-editor/dkt/models/crdt-local-dispatch.test.ts',
			'src/video-editor/dkt/models/crdt-rollback.test.ts',
			'src/video-editor/dkt/models/crdt-resolution-attempt.test.ts',
			'src/video-editor/dkt/models/crdt-conflict-scenarios.test.ts',
			'src/video-editor/dkt/runtime/createMiniCutDktRuntime.crdt.test.ts',
			'src/video-editor/dkt/runtime/createMiniCutDktRuntime.crdtRelay.test.ts',
			'src/video-editor/dkt/crdt/**/*.test.ts',
			'src/video-editor/dkt/maelstrom/**/*.test.ts',
			'src/video-editor/dkt/maelstrom/**/*.maelstrom.test.ts',
			'src/video-editor/components/ClipConflictBadge.test.tsx',
		],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
		setupFiles: ['./src/video-editor/tests/setup.ts'],
	},
})
