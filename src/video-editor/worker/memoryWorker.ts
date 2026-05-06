import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import { createMiniCutDktRuntime } from '../dkt/runtime/createMiniCutDktRuntime'
import type { MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'
import { PATCH, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry } from '../domain/types'
import type { EditorAuthorityClient } from './authorityClient'
import { buildWorkerDerivedIndexes, type WorkerDerivedIndexes } from './derivedIndexes'

type PatchListener = (envelope: PatchEnvelope) => void

export class MemoryWorkerAuthority implements EditorAuthorityClient {
	#registry: ProjectRegistry = createEmptyRegistry()
	#indexes: WorkerDerivedIndexes = buildWorkerDerivedIndexes(this.#registry)
	#dktRuntime = createMiniCutDktRuntime({ enabled: true })
	#dktSyncQueue: Promise<void> = Promise.resolve()

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
		this.#queueDktSnapshotSync()

		for (const listener of this.#listeners) {
			listener(result.envelope)
		}

		return result
	}

	replaceSnapshot(snapshot: ProjectRegistry): Promise<void> {
		this.#registry = structuredClone(snapshot)
		this.#indexes = buildWorkerDerivedIndexes(this.#registry)
		const dktSync = this.#queueDktSnapshotSync()
		this.#notify(createRegistrySetEnvelope(this.#registry))

		return dktSync
	}

	flushDktSync(): Promise<void> {
		return this.#dktSyncQueue
	}

	openDktTransport(): DomSyncTransportLike<MiniCutDktTransportMessage> {
		const pageListeners = new Set<(message: MiniCutDktTransportMessage) => void>()
		const workerListeners = new Set<(message: MiniCutDktTransportMessage) => void>()
		const connection = this.#dktRuntime.connect({
			send(message) {
				for (const listener of pageListeners) {
					listener(message)
				}
			},
			listen(listener) {
				workerListeners.add(listener)
				return () => {
					workerListeners.delete(listener)
				}
			},
			destroy() {
				workerListeners.clear()
			},
		})

		this.#queueDktSnapshotSync()

		return {
			send(message) {
				for (const listener of [...workerListeners]) {
					listener(message)
				}
			},
			listen(listener) {
				pageListeners.add(listener)
				return () => {
					pageListeners.delete(listener)
				}
			},
			destroy() {
				pageListeners.clear()
				workerListeners.clear()
				connection.destroy()
			},
		}
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

	#queueDktSnapshotSync(): Promise<void> {
		const snapshot = structuredClone(this.#registry)
		this.#dktSyncQueue = this.#dktSyncQueue
			.then(() => this.#dktRuntime.replaceRegistryState(snapshot))
			.then(() => undefined)

		return this.#dktSyncQueue
	}
}

const getRegistryEnvelopeProjectId = (registry: ProjectRegistry): string =>
	registry.activeProjectId ?? Object.keys(registry.projects)[0] ?? '__workspace__'

const createRegistrySetEnvelope = (registry: ProjectRegistry): PatchEnvelope => ({
	projectId: getRegistryEnvelopeProjectId(registry),
	version: registry.projects[getRegistryEnvelopeProjectId(registry)]?.version ?? 0,
	patches: [{ c: PATCH.REGISTRY_SET, p: { registry: structuredClone(registry) } }],
})