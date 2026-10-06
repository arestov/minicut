import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { dktViteAliases } from './scripts/dktAliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const resolve = {
	alias: {
		'@video-editor': path.resolve(__dirname, 'src/video-editor'),
		...dktViteAliases,
	},
}

const crdtNodeProject = defineConfig({
	resolve: {
		alias: resolve.alias,
	},
	test: {
		name: 'crdt-node',
		globals: true,
		environment: 'node',
		fileParallelism: true,
		maxWorkers: 4,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: [
			'src/video-editor/dkt/models/semantic-graph-declarations.test.ts',
			'src/video-editor/dkt/models/crdt-field-coverage.test.ts',
			'src/video-editor/dkt/models/crdt-local-dispatch.test.ts',
			'src/video-editor/dkt/models/crdt-rollback.test.ts',
			'src/video-editor/dkt/models/crdt-resolution-attempt.test.ts',
			'src/video-editor/dkt/models/crdt-conflict-scenarios.test.ts',
			'src/video-editor/dkt/models/crdt-review-p2p-projection.test.ts',
			'src/video-editor/dkt/review/headless/**/*.headless.test.ts',
			'src/video-editor/dkt/runtime/createMiniCutDktRuntime.crdt.test.ts',
			'src/video-editor/dkt/runtime/createMiniCutDktRuntime.crdtRelay.test.ts',
			'src/video-editor/dkt/crdt/**/*.test.ts',
			'src/video-editor/dkt/storage/**/*.test.ts',
			'src/video-editor/dkt/maelstrom/**/*.test.ts',
			'src/video-editor/dkt/maelstrom/**/*.maelstrom.test.ts',
		],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
	},
})

const crdtDomProject = defineConfig({
	plugins: [react()],
	resolve: {
		alias: resolve.alias,
	},
	test: {
		name: 'crdt-dom',
		globals: true,
		environment: 'jsdom',
		fileParallelism: false,
		maxWorkers: 1,
		hookTimeout: 30_000,
		testTimeout: 30_000,
		include: ['src/video-editor/components/ClipConflictBadge.test.tsx'],
		exclude: ['node_modules/**', 'dist*/**', 'tmp/dkt/**'],
		setupFiles: ['./src/video-editor/tests/setup.ts'],
	},
})

export default defineConfig({
	test: {
		projects: [crdtNodeProject, crdtDomProject],
	},
})
