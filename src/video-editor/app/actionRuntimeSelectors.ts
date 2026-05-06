import { getClipIdsForTrack, getTracks } from '../domain/selectors'
import type { ProjectRegistry } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'

export const getActionActiveProjectId = (env: EditorActionEnvironment): string => {
	const registry = env.stores.getRegistry()
	const session = env.session.get()
	const sessionProjectId = session.activeProjectId
	if (
		typeof sessionProjectId === 'string'
		&& sessionProjectId
		&& (registry.projects[sessionProjectId] || Object.keys(registry.projects).length === 0)
	) {
		return sessionProjectId
	}

	const registryProjectId = registry.activeProjectId
	if (registryProjectId && registry.projects[registryProjectId]) {
		return registryProjectId
	}

	const projectId = Object.keys(registry.projects)[0]
	if (!projectId) {
		throw new Error('No active project selected')
	}

	return projectId
}

export const isProjectTimelineEmpty = (registry: ProjectRegistry, projectId: string): boolean => {
	const project = registry.projects[projectId]
	if (!project) {
		return false
	}

	return getTracks(registry, project).every((track) => getClipIdsForTrack(registry, track.id).length === 0)
}
