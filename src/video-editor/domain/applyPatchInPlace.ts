import { registryPatchAppliers, type RegistryPatchApplyState } from './patchAppliers'
import type { PatchEnvelope, ProjectRegistry } from './types'

export const applyPatchEnvelopeInPlace = (
	registry: ProjectRegistry,
	envelope: PatchEnvelope,
): ProjectRegistry => {
	const state: RegistryPatchApplyState = {
		registry,
		envelope,
		project: envelope.projectId ? registry.projects[envelope.projectId] : undefined,
		didSetRegistry: false,
	}

	for (const patch of envelope.patches) {
		const applier = registryPatchAppliers[patch.c]
		if (!applier) {
			throw new Error(`Unsupported patch code ${(patch as { c: number }).c}`)
		}
		applier(state, patch)
	}

	if (state.project && !state.didSetRegistry) {
		state.project.version = envelope.version
	}

	return state.registry
}
