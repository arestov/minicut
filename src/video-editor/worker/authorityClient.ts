import type { Command, DispatchResult, PatchEnvelope, ProjectRegistry } from '../domain/types'

export type PatchListener = (envelope: PatchEnvelope) => void

export interface EditorAuthorityClient {
	getSnapshot(): ProjectRegistry | Promise<ProjectRegistry>
	subscribe(listener: PatchListener): () => void
	dispatch(command: Command): DispatchResult | Promise<DispatchResult>
	destroy?(): void
}