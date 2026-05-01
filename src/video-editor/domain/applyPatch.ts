import { applyPatchEnvelopeInPlace } from './applyPatchInPlace'
import type { PatchEnvelope, ProjectRegistry } from './types'

export const applyPatchEnvelopeToRegistry = (
	registry: ProjectRegistry,
	envelope: PatchEnvelope,
): ProjectRegistry => {
	const nextRegistry: ProjectRegistry = {
		activeProjectId: registry.activeProjectId,
		projects: { ...registry.projects },
		entitiesById: { ...registry.entitiesById },
	}

	return applyPatchEnvelopeInPlace(nextRegistry, envelope)
}
