import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import type { PatchEnvelope, ProjectRegistry } from '../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

type DktSyncMessage = Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>
type Listener = () => void

const cloneRegistry = (snapshot: ProjectRegistry): ProjectRegistry => structuredClone(snapshot)

export interface RegistryRenderSource {
	getSnapshot(): ProjectRegistry
	subscribe(listener: Listener): () => void
}

export interface DktRegistryRenderStore extends RegistryRenderSource {
	setSnapshot(snapshot: ProjectRegistry): void
	applyPatchEnvelope(envelope: PatchEnvelope): void
	handleDktSyncMessage(message: DktSyncMessage): void
}

/** @deprecated Compatibility source for legacy read models while DKT page runtime rollout is incomplete. */
export const createDktRegistryRenderStore = (initialSnapshot: ProjectRegistry = createEmptyRegistry()): DktRegistryRenderStore => {
	let snapshot = cloneRegistry(initialSnapshot)
	const listeners = new Set<Listener>()

	const notify = (): void => {
		for (const listener of listeners) {
			listener()
		}
	}

	const setSnapshot = (nextSnapshot: ProjectRegistry): void => {
		snapshot = cloneRegistry(nextSnapshot)
		notify()
	}

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		setSnapshot,
		applyPatchEnvelope(envelope) {
			setSnapshot(applyPatchEnvelopeToRegistry(snapshot, envelope))
		},
		handleDktSyncMessage(_message) {
			// Legacy store no longer derives state from root attrs.
		},
	}
}
