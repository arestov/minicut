import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import type { Command, DispatchResult, PatchEnvelope, ProjectRegistry } from '../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

export type PatchListener = (envelope: PatchEnvelope) => void
export type DktSyncListener = (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void

export interface EditorAuthorityClient {
	getSnapshot(): ProjectRegistry | Promise<ProjectRegistry>
	subscribe(listener: PatchListener): () => void
	subscribeDktSync?(listener: DktSyncListener): () => void
	openDktTransport?(): DomSyncTransportLike<MiniCutDktTransportMessage>
	dispatch(command: Command): DispatchResult | Promise<DispatchResult>
	replaceSnapshot?(snapshot: ProjectRegistry): void | Promise<void>
	flushDktSync?(): Promise<void>
	destroy?(): void
}