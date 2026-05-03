import { runAuthorityClientContract } from './authorityClient.contract'
import { createFallbackAuthorityClient } from './fallbackAuthorityClient'

runAuthorityClientContract({
	label: 'FallbackAuthorityClient',
	createClient: () => createFallbackAuthorityClient(),
})
