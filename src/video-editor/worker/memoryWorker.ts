import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import type { Command, DispatchResult, PatchEnvelope, ProjectRegistry } from '../domain/types'
import type { EditorAuthorityClient } from './authorityClient'
import { buildWorkerDerivedIndexes, type WorkerDerivedIndexes } from './derivedIndexes'

type PatchListener = (envelope: PatchEnvelope) => void

export class MemoryWorkerAuthority implements EditorAuthorityClient {
	#registry: ProjectRegistry = createEmptyRegistry()
	#indexes: WorkerDerivedIndexes = buildWorkerDerivedIndexes(this.#registry)

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
		const result = buildDispatchResult(this.#registry, command, this.#indexes)
		applyPatchEnvelopeInPlace(this.#registry, result.envelope)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)

		for (const listener of this.#listeners) {
			listener(result.envelope)
		}

		return result
	}

	destroy(): void {
		this.#listeners.clear()
	}

	getDerivedIndexes(): WorkerDerivedIndexes {
		return structuredClone(this.#indexes)
	}
}