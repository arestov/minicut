import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'
import type { EditorAuthorityClient } from './authorityClient'

const DEFAULT_DKT_SHARED_WORKER_NAME = 'minicut-video-editor-dkt-runtime'

export interface DktSharedWorkerAuthorityClientOptions {
	workerUrl?: string | URL
	name?: string
	onError?: (error: Error) => void
	onSyncMessage?: (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void
}

/**
 * Phase 1 hard rewrite: DKT-only SharedWorker authority client.
 * No registry snapshot, no command dispatch, no patch listeners.
 */
export class DktSharedWorkerAuthorityClient implements EditorAuthorityClient {
	#worker: SharedWorker
	#onError?: (error: Error) => void
	#onSyncMessage?: (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void
	#transportListeners = new Set<(message: MiniCutDktTransportMessage) => void>()
	#isDestroyed = false
	#loadFailed = false

	constructor(options: DktSharedWorkerAuthorityClientOptions = {}) {
		this.#onError = options.onError
		this.#onSyncMessage = options.onSyncMessage
		this.#worker = options.workerUrl
			? new SharedWorker(options.workerUrl, {
				type: 'module',
				name: options.name ?? DEFAULT_DKT_SHARED_WORKER_NAME,
			})
			: new SharedWorker(new URL('./dktSharedWorker.ts', import.meta.url), {
				type: 'module',
				name: options.name ?? DEFAULT_DKT_SHARED_WORKER_NAME,
			})
		this.#worker.onerror = (event) => {
			console.error(event.message, event)
			const error = new Error('DKT SharedWorker failed to load')
			this.#loadFailed = true
			this.#onError?.(error)
		}
		this.#worker.port.onmessage = (event: MessageEvent<MiniCutDktTransportMessage>) => {
			this.#handleMessage(event.data)
		}
		this.#worker.port.onmessageerror = () => {
			const error = new Error('DKT SharedWorker port message error')
			this.#onError?.(error)
		}
		this.#worker.port.start()
		this.#worker.port.postMessage({ type: DKT_MSG.BOOTSTRAP } satisfies MiniCutDktTransportMessage)
	}

	subscribeDktSync(listener: (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void): () => void {
		const previous = this.#onSyncMessage
		this.#onSyncMessage = (message) => {
			previous?.(message)
			listener(message)
		}
		return () => {
			this.#onSyncMessage = previous
		}
	}

	openDktTransport(): DomSyncTransportLike<MiniCutDktTransportMessage> {
		const localListeners = new Set<(message: MiniCutDktTransportMessage) => void>()
		const forward = (message: MiniCutDktTransportMessage) => {
			for (const listener of localListeners) {
				listener(message)
			}
		}

		this.#transportListeners.add(forward)

		return {
			send: (message) => {
				if (!this.#isDestroyed) {
					this.#worker.port.postMessage(message)
				}
			},
			listen(listener) {
				localListeners.add(listener)
				return () => {
					localListeners.delete(listener)
				}
			},
			destroy: () => {
				localListeners.clear()
				this.#transportListeners.delete(forward)
			},
		}
	}

	#handleMessage(message: MiniCutDktTransportMessage): void {
		for (const listener of this.#transportListeners) {
			listener(message)
		}

		switch (message.type) {
			case DKT_MSG.SYNC_HANDLE:
				this.#onSyncMessage?.(message)
				break
			case DKT_MSG.RUNTIME_ERROR:
					this.#onError?.(new Error(String(message.message)))
				break
		}
	}

	destroy(): void {
		if (this.#isDestroyed) {
			return
		}
		this.#isDestroyed = true
		this.#transportListeners.clear()
	}
}

export const canUseDktSharedWorkerAuthority = (): boolean =>
	typeof SharedWorker !== 'undefined'
