import { withEnvelopeVersion } from './selectors'
import { PATCH, type Patch, type PatchEnvelope, type Project, type ProjectRegistry, type RelValue } from './types'

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

export interface RegistryPatchApplyState {
	registry: ProjectRegistry
	envelope: PatchEnvelope
	project?: Project
	didSetRegistry: boolean
}

export type RegistryPatchApplier<PatchType extends Patch = Patch> = (
	state: RegistryPatchApplyState,
	patch: PatchType,
) => void

const requireProject = (state: RegistryPatchApplyState, patchName: string): Project => {
	if (!state.project) {
		throw new Error(`Missing project ${state.envelope.projectId} for ${patchName}`)
	}

	return state.project
}

type PatchByCode<Code extends Patch['c']> = Extract<Patch, { c: Code }>

export const registryPatchAppliers: Partial<Record<Patch['c'], RegistryPatchApplier>> = {
	[PATCH.REGISTRY_SET]: (state, patch: PatchByCode<typeof PATCH.REGISTRY_SET>) => {
		state.registry.activeProjectId = patch.p.registry.activeProjectId
		state.registry.projects = structuredClone(patch.p.registry.projects)
		state.registry.entitiesById = structuredClone(patch.p.registry.entitiesById)
		state.project = state.envelope.projectId ? state.registry.projects[state.envelope.projectId] : undefined
		state.didSetRegistry = true
	},
	[PATCH.PROJECT_SET]: (state, patch: PatchByCode<typeof PATCH.PROJECT_SET>) => {
		state.project = withEnvelopeVersion(patch.p.project, state.envelope)
		state.registry.projects[patch.p.project.id] = state.project
	},
	[PATCH.ENTITY_SET]: (state, patch: PatchByCode<typeof PATCH.ENTITY_SET>) => {
		requireProject(state, 'ENTITY_SET')
		state.registry.entitiesById[patch.p.entity.id] = patch.p.entity
	},
	[PATCH.ENTITY_DELETE]: (state, patch: PatchByCode<typeof PATCH.ENTITY_DELETE>) => {
		requireProject(state, 'ENTITY_DELETE')
		delete state.registry.entitiesById[patch.p.id]
	},
	[PATCH.ATTRS_MERGE]: (state, patch: PatchByCode<typeof PATCH.ATTRS_MERGE>) => {
		requireProject(state, 'ATTRS_MERGE')
		const current = state.registry.entitiesById[patch.p.id]
		state.registry.entitiesById[patch.p.id] = {
			...current,
			attrs: {
				...current.attrs,
				...patch.p.attrs,
			},
		}
	},
	[PATCH.SCALAR_SET]: (state, patch: PatchByCode<typeof PATCH.SCALAR_SET>) => {
		requireProject(state, 'SCALAR_SET')
		const current = state.registry.entitiesById[patch.p.id]
		state.registry.entitiesById[patch.p.id] = {
			...current,
			attrs: setNestedAttrValue(current.attrs, patch.p.path, patch.p.value),
		}
	},
	[PATCH.REL_SPLICE]: (state, patch: PatchByCode<typeof PATCH.REL_SPLICE>) => {
		requireProject(state, 'REL_SPLICE')
		const current = state.registry.entitiesById[patch.p.id]
		const relValue = cloneRelValue(current.rels[patch.p.rel])
		const relArray = Array.isArray(relValue) ? relValue : []
		relArray.splice(patch.p.index, patch.p.deleteCount, ...patch.p.insert)
		state.registry.entitiesById[patch.p.id] = {
			...current,
			rels: {
				...current.rels,
				[patch.p.rel]: relArray,
			},
		}
	},
	[PATCH.WORKSPACE_ACTIVE_PROJECT_SET]: (state, patch: PatchByCode<typeof PATCH.WORKSPACE_ACTIVE_PROJECT_SET>) => {
		state.registry.activeProjectId = patch.p.projectId
	},
}
