import type { PatchEnvelope, ProjectGraph, ProjectRegistry, RelValue } from './types'
import { PATCH } from './types'
import { withEnvelopeVersion } from './selectors'

const cloneProject = (project: ProjectGraph): ProjectGraph => ({
	...project,
	entities: { ...project.entities },
})

const cloneRelValue = (value: RelValue): RelValue => {
	if (Array.isArray(value)) {
		return [...value]
	}

	return value
}

export const applyPatchEnvelopeToRegistry = (
	registry: ProjectRegistry,
	envelope: PatchEnvelope,
): ProjectRegistry => {
	const nextRegistry: ProjectRegistry = {
		activeProjectId: registry.activeProjectId,
		projects: { ...registry.projects },
	}

	let project = envelope.projectId ? nextRegistry.projects[envelope.projectId] : undefined
	if (project) {
		project = cloneProject(project)
		nextRegistry.projects[envelope.projectId] = project
	}

	for (const patch of envelope.patches) {
		switch (patch.c) {
			case PATCH.PROJECT_SET: {
				project = withEnvelopeVersion(patch.p.project, envelope)
				nextRegistry.projects[patch.p.project.id] = project
				break
			}

			case PATCH.ENTITY_SET: {
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for ENTITY_SET`)
				}

				project.entities[patch.p.entity.id] = patch.p.entity
				break
			}

			case PATCH.ATTRS_MERGE: {
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for ATTRS_MERGE`)
				}

				const current = project.entities[patch.p.id]
				project.entities[patch.p.id] = {
					...current,
					attrs: {
						...current.attrs,
						...patch.p.attrs,
					},
				}
				break
			}

			case PATCH.REL_SPLICE: {
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for REL_SPLICE`)
				}

				const current = project.entities[patch.p.id]
				const relValue = cloneRelValue(current.rels[patch.p.rel])
				const relArray = Array.isArray(relValue) ? relValue : []
				relArray.splice(patch.p.index, patch.p.deleteCount, ...patch.p.insert)
				project.entities[patch.p.id] = {
					...current,
					rels: {
						...current.rels,
						[patch.p.rel]: relArray,
					},
				}
				break
			}

			case PATCH.WORKSPACE_ACTIVE_PROJECT_SET: {
				nextRegistry.activeProjectId = patch.p.projectId
				break
			}

			default: {
				throw new Error(`Unsupported patch code ${(patch as { c: number }).c}`)
			}
		}
	}

	if (project) {
		project.version = envelope.version
	}

	return nextRegistry
}
