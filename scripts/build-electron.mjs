// Builds the three Electron entrypoints into dist-electron/:
//   main     ESM, Node target, bundled (dkt aliases resolved), native deps external
//   preload  CJS, sandbox-compatible, only `electron` is external
//   renderer Vite React app (vite.electron.config.js)
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { dktViteAliases } from './dktAliases.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = path.join(repoRoot, 'src/video-editor/hosts/electron')
const outRoot = path.join(repoRoot, 'dist-electron')

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)]

export const buildNodeEntry = ({ entry, outDir, format, fileName, external }) =>
	build({
		configFile: false,
		logLevel: 'warn',
		resolve: {
			alias: {
				'@video-editor': path.join(repoRoot, 'src/video-editor'),
				...dktViteAliases,
			},
		},
		ssr: { noExternal: true },
		build: {
			ssr: entry,
			outDir,
			emptyOutDir: true,
			target: 'node24',
			minify: false,
			sourcemap: true,
			rollupOptions: {
				external: [...nodeBuiltins, ...external],
				output: { format, entryFileNames: fileName },
			},
		},
	})

export const buildElectron = async ({ renderer = true } = {}) => {
	await buildNodeEntry({
		entry: path.join(hostDir, 'main/main.ts'),
		outDir: path.join(outRoot, 'main'),
		format: 'es',
		fileName: 'main.mjs',
		external: ['electron', 'classic-level'],
	})
	await buildNodeEntry({
		entry: path.join(hostDir, 'preload/preload.ts'),
		outDir: path.join(outRoot, 'preload'),
		format: 'cjs',
		fileName: 'preload.cjs',
		external: ['electron'],
	})
	if (renderer) {
		await build({
			configFile: path.join(repoRoot, 'vite.electron.config.js'),
			logLevel: 'warn',
		})
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await buildElectron()
	console.log('electron build complete: dist-electron/')
}
