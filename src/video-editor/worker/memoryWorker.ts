import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import { PATCH, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry } from '../domain/types'
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

	replaceSnapshot(snapshot: ProjectRegistry): void {
		this.#registry = structuredClone(snapshot)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)
		this.#notify(createRegistrySetEnvelope(this.#registry))
	}

	#notify(envelope: PatchEnvelope): void {
		for (const listener of this.#listeners) {
			listener(envelope)
		}
	}

	destroy(): void {
		this.#listeners.clear()
	}

	getDerivedIndexes(): WorkerDerivedIndexes {
		return structuredClone(this.#indexes)
	}
}

const getRegistryEnvelopeProjectId = (registry: ProjectRegistry): string =>
	registry.activeProjectId ?? Object.keys(registry.projects)[0] ?? '__workspace__'

const createRegistrySetEnvelope = (registry: ProjectRegistry): PatchEnvelope => ({
	projectId: getRegistryEnvelopeProjectId(registry),
	version: registry.projects[getRegistryEnvelopeProjectId(registry)]?.version ?? 0,
	patches: [{ c: PATCH.REGISTRY_SET, p: { registry: structuredClone(registry) } }],
})