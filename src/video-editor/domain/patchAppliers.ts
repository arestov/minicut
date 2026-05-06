import { withEnvelopeVersion } from './selectors'
import { PATCH, type Patch, type PatchEnvelope, type ProjectGraph, type ProjectRegistry, type RelValue } from './types'

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
	project?: ProjectGraph
	didSetRegistry: boolean
}

export type RegistryPatchApplier<PatchType extends Patch = Patch> = (
	state: RegistryPatchApplyState,
	patch: PatchType,
) => void

const requireProject = (state: RegistryPatchApplyState, patchName: string): ProjectGraph => {
	if (!state.project) {
		throw new Error(`Missing project ${state.envelope.projectId} for ${patchName}`)
	}

	return state.project
}

type PatchByCode<Code extends Patch['c']> = Extract<Patch, { c: Code }>

export const registryPatchAppliers: Partial<Record<Patch['c'], RegistryPatchApplier>> = {
	[PATCH.REGISTRY_SET]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.REGISTRY_SET>
		state.registry.activeProjectId = typedPatch.p.registry.activeProjectId
		state.registry.projects = structuredClone(typedPatch.p.registry.projects)
		state.registry.entitiesById = structuredClone(typedPatch.p.registry.entitiesById)
		state.project = state.envelope.projectId ? state.registry.projects[state.envelope.projectId] : undefined
		state.didSetRegistry = true
	},
	[PATCH.PROJECT_SET]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.PROJECT_SET>
		state.project = withEnvelopeVersion(typedPatch.p.project, state.envelope)
		state.registry.projects[typedPatch.p.project.id] = state.project
	},
	[PATCH.ENTITY_SET]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.ENTITY_SET>
		requireProject(state, 'ENTITY_SET')
		state.registry.entitiesById[typedPatch.p.entity.id] = typedPatch.p.entity
	},
	[PATCH.ENTITY_DELETE]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.ENTITY_DELETE>
		requireProject(state, 'ENTITY_DELETE')
		delete state.registry.entitiesById[typedPatch.p.id]
	},
	[PATCH.ATTRS_MERGE]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.ATTRS_MERGE>
		requireProject(state, 'ATTRS_MERGE')
		const current = state.registry.entitiesById[typedPatch.p.id]
		state.registry.entitiesById[typedPatch.p.id] = {
			...current,
			attrs: {
				...current.attrs,
				...typedPatch.p.attrs,
			},
		}
	},
	[PATCH.SCALAR_SET]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.SCALAR_SET>
		requireProject(state, 'SCALAR_SET')
		const current = state.registry.entitiesById[typedPatch.p.id]
		state.registry.entitiesById[typedPatch.p.id] = {
			...current,
			attrs: setNestedAttrValue(current.attrs, typedPatch.p.path, typedPatch.p.value),
		}
	},
	[PATCH.REL_SPLICE]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.REL_SPLICE>
		requireProject(state, 'REL_SPLICE')
		const current = state.registry.entitiesById[typedPatch.p.id]
		const relValue = cloneRelValue(current.rels[typedPatch.p.rel])
		const relArray = Array.isArray(relValue) ? relValue : []
		relArray.splice(typedPatch.p.index, typedPatch.p.deleteCount, ...typedPatch.p.insert)
		state.registry.entitiesById[typedPatch.p.id] = {
			...current,
			rels: {
				...current.rels,
				[typedPatch.p.rel]: relArray,
			},
		}
	},
	[PATCH.WORKSPACE_ACTIVE_PROJECT_SET]: (state, patch) => {
		const typedPatch = patch as PatchByCode<typeof PATCH.WORKSPACE_ACTIVE_PROJECT_SET>
		state.registry.activeProjectId = typedPatch.p.projectId
	},
}
