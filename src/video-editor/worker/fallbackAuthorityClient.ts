import type { EditorAuthorityClient } from './authorityClient'
import { MemoryWorkerAuthority } from './memoryWorker'
import { canUseSharedWorkerAuthority, SharedWorkerAuthorityClient } from './sharedWorkerClient'

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

	if (canUseSharedWorkerAuthority()) {
		try {
			attach(new SharedWorkerAuthorityClient({
				workerUrl: options.workerUrl,
				name: options.name,
				onError: switchToMemory,
			}))
		} catch (error) {
			console.warn('[minicut:worker] SharedWorker construction failed', error)
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
		getHistoryState() {
			return invoke((client) => client.getHistoryState())
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
		undo() {
			return invoke((client) => client.undo())
		},
		redo() {
			return invoke((client) => client.redo())
		},
		destroy() {
			unsubscribe?.()
			listeners.clear()
			active.destroy?.()
		},
	}
}
