import type { EditorActionEnvironment } from './editorActionEnvironment'

export const getActionActiveProjectId = (env: EditorActionEnvironment): string => {
	const rootScope = env.dkt?.getRootScope()
	if (rootScope) {
		const projectScope = env.dkt?.readOne(rootScope, 'activeProject')
		if (projectScope) {
			const sourceProjectId = env.dkt?.readAttrs(projectScope, ['sourceProjectId']).sourceProjectId
			if (typeof sourceProjectId === 'string' && sourceProjectId) {
				return sourceProjectId
			}
		}
	}

	throw new Error('No active project: DKT activeProject rel not populated')
}
