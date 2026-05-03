import { runAuthorityClientContract } from './authorityClient.contract'
import { MemoryWorkerAuthority } from './memoryWorker'

runAuthorityClientContract({
	label: 'MemoryWorkerAuthority',
	createClient: () => new MemoryWorkerAuthority(),
})
