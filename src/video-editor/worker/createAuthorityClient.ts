import type { EditorAuthorityClient } from './authorityClient'
import { MemoryWorkerAuthority } from './memoryWorker'
import { canUseSharedWorkerAuthority, SharedWorkerAuthorityClient } from './sharedWorkerClient'

export const createAuthorityClient = (): EditorAuthorityClient => {
	if (canUseSharedWorkerAuthority()) {
		return new SharedWorkerAuthorityClient()
	}

	return new MemoryWorkerAuthority()
}