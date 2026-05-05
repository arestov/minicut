import { createEmptyRegistry } from '../../domain/createProject'
import type { ProjectRegistry } from '../../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'
import { createDktRegistryRenderStore, type RegistryRenderSource } from '../../render-sync/DktRegistryRenderStore'

type SyncHandleMessage = Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>

export interface MiniCutDktPageSyncReceiver extends RegistryRenderSource {
	handleMessage(message: MiniCutDktTransportMessage): void
	setSnapshot(snapshot: ProjectRegistry): void
}

export const createMiniCutDktPageSyncReceiver = (
	initialSnapshot: ProjectRegistry = createEmptyRegistry(),
): MiniCutDktPageSyncReceiver => {
	const store = createDktRegistryRenderStore(initialSnapshot)

	return {
		getSnapshot: store.getSnapshot,
		subscribe: store.subscribe,
		setSnapshot(snapshot) {
			store.setSnapshot(snapshot)
		},
		handleMessage(message) {
			if (message.type === DKT_MSG.SNAPSHOT) {
				store.setSnapshot(message.snapshot as ProjectRegistry)
				return
			}
			if (message.type === DKT_MSG.PATCHES) {
				store.applyPatchEnvelope(message.envelope as Parameters<typeof store.applyPatchEnvelope>[0])
				return
			}
			if (message.type === DKT_MSG.SYNC_HANDLE) {
				store.handleDktSyncMessage(message as SyncHandleMessage)
			}
		},
	}
}
