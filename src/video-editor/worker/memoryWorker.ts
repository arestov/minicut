import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import { PATCH, type Command, type DispatchResult, type HistoryState, type PatchEnvelope, type ProjectRegistry } from '../domain/types'
import type { EditorAuthorityClient } from './authorityClient'
import { buildWorkerDerivedIndexes, type WorkerDerivedIndexes } from './derivedIndexes'

type PatchListener = (envelope: PatchEnvelope) => void

export class MemoryWorkerAuthority implements EditorAuthorityClient {
	#registry: ProjectRegistry = createEmptyRegistry()
	#indexes: WorkerDerivedIndexes = buildWorkerDerivedIndexes(this.#registry)
	#undoStack: ProjectRegistry[] = []
	#redoStack: ProjectRegistry[] = []

	#listeners = new Set<PatchListener>()

	getSnapshot(): ProjectRegistry {
		return structuredClone(this.#registry)
	}

	getHistoryState(): HistoryState {
		return { canUndo: this.#undoStack.length > 0, canRedo: this.#redoStack.length > 0 }
	}

	subscribe(listener: PatchListener): () => void {
		this.#listeners.add(listener)
		return () => {
			this.#listeners.delete(listener)
		}
	}

	dispatch(command: Command): DispatchResult {
		const before = structuredClone(this.#registry)
		const result = buildDispatchResult(this.#registry, command, this.#indexes)
		applyPatchEnvelopeInPlace(this.#registry, result.envelope)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)
		this.#undoStack.push(before)
		this.#redoStack = []

		for (const listener of this.#listeners) {
			listener(result.envelope)
		}

		return result
	}

	undo(): PatchEnvelope | null {
		const previous = this.#undoStack.pop()
		if (!previous) {
			return null
		}

		this.#redoStack.push(structuredClone(this.#registry))
		this.#registry = structuredClone(previous)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)
		const envelope = createRegistrySetEnvelope(this.#registry)
		this.#notify(envelope)
		return envelope
	}

	redo(): PatchEnvelope | null {
		const next = this.#redoStack.pop()
		if (!next) {
			return null
		}

		this.#undoStack.push(structuredClone(this.#registry))
		this.#registry = structuredClone(next)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)
		const envelope = createRegistrySetEnvelope(this.#registry)
		this.#notify(envelope)
		return envelope
	}

	replaceSnapshot(snapshot: ProjectRegistry): void {
		this.#registry = structuredClone(snapshot)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)
		this.#undoStack = []
		this.#redoStack = []
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