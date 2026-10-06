// Single source of truth for `dkt` / `dkt-all` resolution.
// Consumed by Vite, Vitest, the Node loader hook and the Bun plugin preload.
// tsconfig.video-editor.json `paths` mirrors it (checked by dktAliases.test.ts).
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const DKT_ALIAS_REPO_ROOT = repoRoot
export const DKT_ROOT = path.resolve(repoRoot, 'tmp/dkt/js')
export const DKT_PROVODA_ROOT = path.resolve(DKT_ROOT, 'libs/provoda/provoda')

/** Alias map in the shape of Vite/Vitest `resolve.alias`. */
export const dktViteAliases = Object.freeze({
	dkt: DKT_PROVODA_ROOT,
	'dkt-all': DKT_ROOT,
})

/** Maps an import specifier to an absolute file-system path, or null. */
export const resolveDktAliasPath = (specifier) => {
	if (specifier === 'dkt') return DKT_PROVODA_ROOT
	if (specifier.startsWith('dkt/')) {
		return path.join(DKT_PROVODA_ROOT, specifier.slice('dkt/'.length))
	}
	if (specifier === 'dkt-all') return DKT_ROOT
	if (specifier.startsWith('dkt-all/')) {
		return path.join(DKT_ROOT, specifier.slice('dkt-all/'.length))
	}
	return null
}
