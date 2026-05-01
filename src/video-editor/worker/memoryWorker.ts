import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import type { Command, DispatchResult, PatchEnvelope, ProjectRegistry } from '../domain/types'

type PatchListener = (envelope: PatchEnvelope) => void

export class MemoryWorkerAuthority {
	#registry: ProjectRegistry = createEmptyRegistry()

	#listeners = new Set<PatchListener>()

	getSnapshot(): ProjectRegistry {
		return structuredClone(this.#registry)
	}

	subscribe(listener: PatchListener): () => void {
		this.#listeners.add(listener)
		return () => {
			this.#listeners.delete(listener)
		}
	}

	dispatch(command: Command): DispatchResult {
		const result = buildDispatchResult(this.#registry, command)
		this.#registry = applyPatchEnvelopeToRegistry(this.#registry, result.envelope)

		for (const listener of this.#listeners) {
			listener(result.envelope)
		}

		return result
	}
}