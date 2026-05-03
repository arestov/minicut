import { batch, mergeIntoObservable, observable, type Observable } from '@legendapp/state'
import { createEmptyRegistry } from '../domain/createProject'
import { PATCH, type PatchEnvelope, type ProjectRegistry } from '../domain/types'

export const createProjectsStore = (): Observable<ProjectRegistry> =>
	observable<ProjectRegistry>(createEmptyRegistry())

export const applySnapshot = (
	projects$: Observable<ProjectRegistry>,
	snapshot: ProjectRegistry,
): void => {
	projects$.set(snapshot)
}

export const applyPatchEnvelope = (
	projects$: Observable<ProjectRegistry>,
	envelope: PatchEnvelope,
): void => {
	batch(() => {
		for (const patch of envelope.patches) {
			switch (patch.c) {
				case PATCH.REGISTRY_SET:
					projects$.set(patch.p.registry)
					return

				case PATCH.PROJECT_SET:
					mergeIntoObservable(projects$.projects[patch.p.project.id], {
						...patch.p.project,
						version: envelope.version,
					})
					break

				case PATCH.ENTITY_SET:
					projects$.entitiesById[patch.p.entity.id].set(patch.p.entity)
					break

				case PATCH.ENTITY_DELETE:
					projects$.entitiesById[patch.p.id].delete()
					break

				case PATCH.ATTRS_MERGE:
					projects$.entitiesById[patch.p.id].attrs.assign(patch.p.attrs)
					break

				case PATCH.SCALAR_SET: {
					const path = patch.p.path.split('.')
					let node = projects$.entitiesById[patch.p.id].attrs as unknown as Record<string, Observable<unknown>>
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
					break
				}

				case PATCH.REL_SPLICE: {
					const rel$ = projects$.entitiesById[patch.p.id].rels[patch.p.rel] as unknown as Observable<string[]>
					if (!Array.isArray(rel$.get())) {
						rel$.set([])
					}

					rel$.set((previous) => {
						const next = Array.isArray(previous) ? [...previous] : []
						next.splice(patch.p.index, patch.p.deleteCount, ...patch.p.insert)
						return next
					})
					break
				}

				case PATCH.WORKSPACE_ACTIVE_PROJECT_SET:
					projects$.activeProjectId.set(patch.p.projectId)
					break

				default:
					throw new Error(`Unsupported patch code ${(patch as { c: number }).c}`)
			}
		}

		if (projects$.projects[envelope.projectId].get()) {
			projects$.projects[envelope.projectId].version.set(envelope.version)
		}
	})
}
