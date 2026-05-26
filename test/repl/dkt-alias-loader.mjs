import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const replRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(replRoot, '../..')
const dktRoot = path.resolve(repoRoot, '../linkcraft/dkt')

const resolveAlias = (specifier) => {
	if (specifier === 'dkt') {
		return path.join(dktRoot, 'js/libs/provoda/provoda')
	}

	if (specifier.startsWith('dkt/')) {
		return path.join(dktRoot, 'js/libs/provoda/provoda', specifier.slice(4))
	}

	if (specifier === 'dkt-all') {
		return path.join(dktRoot, 'js')
	}

	if (specifier.startsWith('dkt-all/')) {
		return path.join(dktRoot, 'js', specifier.slice(8))
	}

	return null
}

export async function resolve(specifier, context, nextResolve) {
	const resolved = resolveAlias(specifier)
	if (resolved) {
		return {
			url: pathToFileURL(resolved).href,
			shortCircuit: true,
		}
	}

	return nextResolve(specifier, context)
}