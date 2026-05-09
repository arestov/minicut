// TEST-ONLY helpers: keep polling waits out of shared production adapters.
export const sleepTesting = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

export const waitForRuntimeReadyOrThrowTesting = async (
	runtime: { getSnapshot: () => { ready: boolean; booted?: unknown; rootNodeId?: unknown } },
	options?: {
		timeoutMs?: number
		pollMs?: number
		role?: string | null
	}
): Promise<void> => {
	const timeoutMs = options?.timeoutMs ?? 15_000
	const pollMs = options?.pollMs ?? 50
	const role = options?.role ?? null
	const deadline = Date.now() + timeoutMs

	while (!runtime.getSnapshot().ready) {
		if (Date.now() >= deadline) {
			const snapshot = runtime.getSnapshot()
			throw new Error(
				`Runtime not ready after ${timeoutMs}ms (role=${role} booted=${String(snapshot.booted)} rootNodeId=${String(snapshot.rootNodeId)})`
			)
		}
		await sleepTesting(pollMs)
	}
}
