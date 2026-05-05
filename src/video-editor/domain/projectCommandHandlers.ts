import { createProjectGraph } from './createProject'
import { createEntityId } from './id'
import { createResourceImportPatches, getActiveTimeline, getTracks, type CommandHandler } from './applyCommandHelpers'
import { assertProject, assertEntity } from './validateCommand'
import { CMD, PATCH, type Command, type Entity } from './types'

type CommandByCode<Code extends Command['c']> = Extract<Command, { c: Code }>

export const handleProjectCreate: CommandHandler<CommandByCode<typeof CMD.PROJECT_CREATE>> = (registry, command) => {
	const { project, entities } = createProjectGraph(
		command.p.title || '',
		Object.keys(registry.projects).length + 1,
	)

	return {
		envelope: {
			projectId: project.id,
			version: 1,
			patches: [
				{ c: PATCH.PROJECT_SET, p: { project } },
				...entities.map((entity) => ({ c: PATCH.ENTITY_SET, p: { entity } }) as const),
				{ c: PATCH.WORKSPACE_ACTIVE_PROJECT_SET, p: { projectId: project.id } },
			],
		},
		createdIds: { projectId: project.id },
	}
}

export const handleResourceImport: CommandHandler<CommandByCode<typeof CMD.RESOURCE_IMPORT>> = (registry, command) => {
	const project = assertProject(registry, command.p.projectId)
	const projectEntity = assertEntity(registry, project.rootEntityId)
	const { resource, patches } = createResourceImportPatches(registry, projectEntity, command)

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches,
		},
		createdIds: { resourceId: resource.id },
	}
}

export const handleTrackCreate: CommandHandler<CommandByCode<typeof CMD.TRACK_CREATE>> = (registry, command) => {
	const project = assertProject(registry, command.p.projectId)
	const timeline = getActiveTimeline(registry, project)
	const trackCount = getTracks(registry, project).filter((track) => track.attrs.kind === command.p.kind).length
	const trackId = createEntityId()
	const tracks = Array.isArray(timeline.rels.tracks) ? timeline.rels.tracks : []
	const track: Entity = {
		id: trackId,
		type: 'track',
		attrs: {
			kind: command.p.kind,
			name: command.p.name ?? `${command.p.kind === 'video' ? 'V' : 'A'}${trackCount + 1}`,
			muted: false,
			locked: false,
			height: command.p.kind === 'video' ? 72 : 64,
		},
		rels: { clips: [] },
	}

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [
				{ c: PATCH.ENTITY_SET, p: { entity: track } },
				{ c: PATCH.REL_SPLICE, p: { id: timeline.id, rel: 'tracks', index: tracks.length, deleteCount: 0, insert: [trackId] } },
			],
		},
	}
}
