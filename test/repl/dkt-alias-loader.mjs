import { pathToFileURL } from 'node:url'
import { resolveDktAliasPath } from '../../scripts/dktAliases.mjs'

export async function resolve(specifier, context, nextResolve) {
	const resolved = resolveDktAliasPath(specifier)
	if (resolved) {
		return {
			url: pathToFileURL(resolved).href,
			shortCircuit: true,
		}
	}

	return nextResolve(specifier, context)
}
