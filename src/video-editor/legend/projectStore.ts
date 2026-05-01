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
				case PATCH.PROJECT_SET:
					mergeIntoObservable(projects$.projects[patch.p.project.id], {
						...patch.p.project,
						version: envelope.version,
					})
					break

				case PATCH.ENTITY_SET:
					projects$.entitiesById[patch.p.entity.id].set(patch.p.entity)
					break

				case PATCH.ATTRS_MERGE:
					projects$.entitiesById[patch.p.id].attrs.assign(patch.p.attrs)
					break

				case PATCH.REL_SPLICE: {
					const rel$ = projects$.entitiesById[patch.p.id].rels[patch.p.rel]
					if (!Array.isArray(rel$.get())) {
						rel$.set([])
					}

					rel$.splice(patch.p.index, patch.p.deleteCount, ...patch.p.insert)
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
