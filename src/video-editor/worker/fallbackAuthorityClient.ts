import type { EditorAuthorityClient } from './authorityClient'
import type { ProjectRegistry } from '../domain/types'
import { MemoryWorkerAuthority } from './memoryWorker'
import { canUseDktSharedWorkerAuthority, DktSharedWorkerAuthorityClient } from './dktSharedWorkerClient'

type RestorableAuthorityClient = EditorAuthorityClient & {
	replaceSnapshot(snapshot: ProjectRegistry): void | Promise<void>
}

const canReplaceSnapshot = (client: EditorAuthorityClient): client is RestorableAuthorityClient =>
	typeof client.replaceSnapshot === 'function'

const canOpenDktTransport = (client: EditorAuthorityClient): client is EditorAuthorityClient & Required<Pick<EditorAuthorityClient, 'openDktTransport'>> =>
	typeof client.openDktTransport === 'function'

export const createFallbackAuthorityClient = (options: {
	workerUrl?: string | URL
	name?: string
} = {}): EditorAuthorityClient => {
	const listeners = new Set<Parameters<EditorAuthorityClient['subscribe']>[0]>()
	let active!: EditorAuthorityClient
	let unsubscribe: (() => void) | null = null
	let usingFallback = false

	const attach = (client: EditorAuthorityClient): void => {
		unsubscribe?.()
		active = client
		unsubscribe = active.subscribe((envelope) => {
			for (const listener of listeners) {
				listener(envelope)
			}
		})
	}

	const switchToMemory = (reason: unknown): void => {
		if (usingFallback) {
			return
		}

		usingFallback = true
		console.warn('[minicut:worker] Falling back to in-memory authority', reason)
		try {
			active.destroy?.()
		} catch {
			// noop
		}
		attach(new MemoryWorkerAuthority())
	}

	if (canUseDktSharedWorkerAuthority()) {
		try {
			attach(new DktSharedWorkerAuthorityClient({
				workerUrl: options.workerUrl,
				name: options.name,
				onError: switchToMemory,
			}))
		} catch (error) {
			console.warn('[minicut:worker] DKT SharedWorker construction failed', error)
			attach(new MemoryWorkerAuthority())
			usingFallback = true
		}
	} else {
		attach(new MemoryWorkerAuthority())
		usingFallback = true
	}

	const invoke = <T>(operation: (client: EditorAuthorityClient) => T | Promise<T>): Promise<T> =>
		Promise.resolve(operation(active)).catch((error) => {
			if (!usingFallback) {
				switchToMemory(error)
				return Promise.resolve(operation(active))
			}

			throw error
		})

	return {
		getSnapshot() {
			return invoke((client) => client.getSnapshot())
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		dispatch(command) {
			return invoke((client) => client.dispatch(command))
		},
		replaceSnapshot(snapshot) {
			return invoke((client) => {
				if (!canReplaceSnapshot(client)) {
					throw new Error('Active authority cannot replace snapshots')
				}

				return client.replaceSnapshot(snapshot)
			})
		},
		openDktTransport() {
			if (!canOpenDktTransport(active)) {
				throw new Error('Active authority cannot open DKT transport')
			}

			return active.openDktTransport()
		},
		destroy() {
			unsubscribe?.()
			listeners.clear()
			active.destroy?.()
		},
	}
}
