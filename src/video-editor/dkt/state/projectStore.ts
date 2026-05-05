import { batch, mergeIntoObservable, observable, type Observable } from '@legendapp/state'
import { createEmptyRegistry } from '../../domain/createProject'
import { PATCH, type Patch, type PatchEnvelope, type ProjectRegistry } from '../../domain/types'

export const createProjectsStore = (): Observable<ProjectRegistry> =>
	observable<ProjectRegistry>(createEmptyRegistry())

export const applySnapshot = (
	projects$: Observable<ProjectRegistry>,
	snapshot: ProjectRegistry,
): void => {
	projects$.set(snapshot)
}

type PatchByCode<Code extends Patch['c']> = Extract<Patch, { c: Code }>

interface ObservablePatchApplyContext {
	projects$: Observable<ProjectRegistry>
	envelope: PatchEnvelope
	didSetRegistry: boolean
}

type ObservablePatchApplier<PatchType extends Patch = Patch> = (
	context: ObservablePatchApplyContext,
	patch: PatchType,
) => void

const observablePatchAppliers: Partial<Record<Patch['c'], ObservablePatchApplier>> = {
	[PATCH.REGISTRY_SET]: (context, patch: PatchByCode<typeof PATCH.REGISTRY_SET>) => {
		context.projects$.set(patch.p.registry)
		context.didSetRegistry = true
	},
	[PATCH.PROJECT_SET]: (context, patch: PatchByCode<typeof PATCH.PROJECT_SET>) => {
		mergeIntoObservable(context.projects$.projects[patch.p.project.id], {
			...patch.p.project,
			version: context.envelope.version,
		})
	},
	[PATCH.ENTITY_SET]: (context, patch: PatchByCode<typeof PATCH.ENTITY_SET>) => {
		context.projects$.entitiesById[patch.p.entity.id].set(patch.p.entity)
	},
	[PATCH.ENTITY_DELETE]: (context, patch: PatchByCode<typeof PATCH.ENTITY_DELETE>) => {
		context.projects$.entitiesById[patch.p.id].delete()
	},
	[PATCH.ATTRS_MERGE]: (context, patch: PatchByCode<typeof PATCH.ATTRS_MERGE>) => {
		context.projects$.entitiesById[patch.p.id].attrs.assign(patch.p.attrs)
	},
	[PATCH.SCALAR_SET]: (context, patch: PatchByCode<typeof PATCH.SCALAR_SET>) => {
		const path = patch.p.path.split('.')
		let node = context.projects$.entitiesById[patch.p.id].attrs as unknown as Record<string, Observable<unknown>>
		let leaf: Observable<unknown> | undefined
		for (const key of path) {
			const next = node[key]
			if (!next) {
				leaf = undefined
				break
			}

			leaf = next
			node = next as unknown as Record<string, Observable<unknown>>
		}

		leaf?.set(patch.p.value)
	},
	[PATCH.REL_SPLICE]: (context, patch: PatchByCode<typeof PATCH.REL_SPLICE>) => {
		const rel$ = context.projects$.entitiesById[patch.p.id].rels[patch.p.rel] as unknown as Observable<string[]>
		if (!Array.isArray(rel$.get())) {
			rel$.set([])
		}

		rel$.set((previous) => {
			const next = Array.isArray(previous) ? [...previous] : []
			next.splice(patch.p.index, patch.p.deleteCount, ...patch.p.insert)
			return next
		})
	},
	[PATCH.WORKSPACE_ACTIVE_PROJECT_SET]: (context, patch: PatchByCode<typeof PATCH.WORKSPACE_ACTIVE_PROJECT_SET>) => {
		context.projects$.activeProjectId.set(patch.p.projectId)
	},
}

export const applyPatchEnvelope = (
	projects$: Observable<ProjectRegistry>,
	envelope: PatchEnvelope,
): void => {
	batch(() => {
		const context: ObservablePatchApplyContext = {
			projects$,
			envelope,
			didSetRegistry: false,
		}

		for (const patch of envelope.patches) {
			const applier = observablePatchAppliers[patch.c]
			if (!applier) {
				throw new Error(`Unsupported patch code ${(patch as { c: number }).c}`)
			}

			applier(context, patch)

			if (context.didSetRegistry) {
				break
			}
		}

		if (!context.didSetRegistry && projects$.projects[envelope.projectId].get()) {
			projects$.projects[envelope.projectId].version.set(envelope.version)
		}
	})
}
