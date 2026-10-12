// The runtime transpiler cache is shared across checkouts, whose DKT aliases
// can resolve identical source text to different roots. Keep source launches local.
export const createBunRuntimeEnvironment = (env = process.env) => ({
	...env,
	BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
})
