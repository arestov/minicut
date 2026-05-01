import { withEnvelopeVersion } from './selectors'
import { PATCH, type PatchEnvelope, type ProjectRegistry, type RelValue } from './types'

const cloneRelValue = (value: RelValue): RelValue => {
	if (Array.isArray(value)) {
		return [...value]
	}

	return value
}

const setNestedAttrValue = (
	attrs: Record<string, unknown>,
	path: string,
	value: number,
): Record<string, unknown> => {
	const keys = path.split('.')
	if (keys.length < 2) {
		return { ...attrs, [path]: value }
	}

	const nextAttrs = { ...attrs }
	let target: Record<string, unknown> = nextAttrs
	for (let index = 0; index < keys.length - 1; index += 1) {
		const key = keys[index]
		const current = target[key]
		const next = current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {}
		target[key] = next
		target = next
	}

	target[keys[keys.length - 1]] = value
	return nextAttrs
}

export const applyPatchEnvelopeInPlace = (
	registry: ProjectRegistry,
	envelope: PatchEnvelope,
): ProjectRegistry => {
	let project = envelope.projectId ? registry.projects[envelope.projectId] : undefined
	let didSetRegistry = false

	for (const patch of envelope.patches) {
		switch (patch.c) {
			case PATCH.REGISTRY_SET:
				registry.activeProjectId = patch.p.registry.activeProjectId
				registry.projects = structuredClone(patch.p.registry.projects)
				registry.entitiesById = structuredClone(patch.p.registry.entitiesById)
				project = envelope.projectId ? registry.projects[envelope.projectId] : undefined
				didSetRegistry = true
				break

			case PATCH.PROJECT_SET:
				project = withEnvelopeVersion(patch.p.project, envelope)
				registry.projects[patch.p.project.id] = project
				break

			case PATCH.ENTITY_SET:
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for ENTITY_SET`)
				}
				registry.entitiesById[patch.p.entity.id] = patch.p.entity
				break

			case PATCH.ENTITY_DELETE:
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for ENTITY_DELETE`)
				}
				delete registry.entitiesById[patch.p.id]
				break

			case PATCH.ATTRS_MERGE: {
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for ATTRS_MERGE`)
				}
				const current = registry.entitiesById[patch.p.id]
				registry.entitiesById[patch.p.id] = {
					...current,
					attrs: {
						...current.attrs,
						...patch.p.attrs,
					},
				}
				break
			}

			case PATCH.SCALAR_SET: {
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for SCALAR_SET`)
				}
				const current = registry.entitiesById[patch.p.id]
				registry.entitiesById[patch.p.id] = {
					...current,
					attrs: setNestedAttrValue(current.attrs, patch.p.path, patch.p.value),
				}
				break
			}

			case PATCH.REL_SPLICE: {
				if (!project) {
					throw new Error(`Missing project ${envelope.projectId} for REL_SPLICE`)
				}
				const current = registry.entitiesById[patch.p.id]
				const relValue = cloneRelValue(current.rels[patch.p.rel])
				const relArray = Array.isArray(relValue) ? relValue : []
				relArray.splice(patch.p.index, patch.p.deleteCount, ...patch.p.insert)
				registry.entitiesById[patch.p.id] = {
					...current,
					rels: {
						...current.rels,
						[patch.p.rel]: relArray,
					},
				}
				break
			}

			case PATCH.WORKSPACE_ACTIVE_PROJECT_SET:
				registry.activeProjectId = patch.p.projectId
				break

			default:
				throw new Error(`Unsupported patch code ${(patch as { c: number }).c}`)
		}
	}

	if (project && !didSetRegistry) {
		project.version = envelope.version
	}

	return registry
}
