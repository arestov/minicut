import type { Command, DispatchResult, HistoryState, PatchEnvelope, ProjectRegistry } from '../domain/types'

export type PatchListener = (envelope: PatchEnvelope) => void

export interface EditorAuthorityClient {
	getSnapshot(): ProjectRegistry | Promise<ProjectRegistry>
	getHistoryState(): HistoryState | Promise<HistoryState>
	subscribe(listener: PatchListener): () => void
	dispatch(command: Command): DispatchResult | Promise<DispatchResult>
	undo(): PatchEnvelope | null | Promise<PatchEnvelope | null>
	redo(): PatchEnvelope | null | Promise<PatchEnvelope | null>
	destroy?(): void
}