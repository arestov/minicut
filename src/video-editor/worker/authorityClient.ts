import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

export type DktSyncListener = (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void

/**
 * Phase 1 hard rewrite: DKT-only authority client.
 * No registry snapshot, no command dispatch, no patch listeners.
 */
export interface EditorAuthorityClient {
	openDktTransport(): DomSyncTransportLike<MiniCutDktTransportMessage>
	subscribeDktSync?(listener: DktSyncListener): () => void
	flushDktSync?(): Promise<void>
	destroy?(): void
}