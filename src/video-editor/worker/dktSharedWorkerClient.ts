import { nanoid } from 'nanoid'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'
import type { Command, DispatchResult, PatchEnvelope, ProjectRegistry } from '../domain/types'
import type { EditorAuthorityClient, PatchListener } from './authorityClient'

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
	timeoutId: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 5000
const DEFAULT_DKT_SHARED_WORKER_NAME = 'minicut-video-editor-dkt-runtime'

export interface DktSharedWorkerAuthorityClientOptions {
	workerUrl?: string | URL
	name?: string
	requestTimeoutMs?: number
	onError?: (error: Error) => void
	onSyncMessage?: (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void
}

export class DktSharedWorkerAuthorityClient implements EditorAuthorityClient {
	#worker: SharedWorker
	#requestTimeoutMs: number
	#onError?: (error: Error) => void
	#onSyncMessage?: (message: Extract<MiniCutDktTransportMessage, { type: typeof DKT_MSG.SYNC_HANDLE }>) => void
	#listeners = new Set<PatchListener>()
	#pending = new Map<string, PendingRequest>()
	#isDestroyed = false
	#loadFailed = false

	constructor(options: DktSharedWorkerAuthorityClientOptions = {}) {
		this.#requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
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
			this.#failAllPending(new Error('DKT SharedWorker failed to load'))
		}
		this.#worker.port.onmessage = (event: MessageEvent<MiniCutDktTransportMessage>) => {
			this.#handleMessage(event.data)
		}
		this.#worker.port.onmessageerror = () => {
			this.#failAllPending(new Error('DKT SharedWorker port message error'))
		}
		this.#worker.port.start()
		this.#worker.port.postMessage({ type: DKT_MSG.BOOTSTRAP } satisfies MiniCutDktTransportMessage)
	}

	getSnapshot(): Promise<ProjectRegistry> {
		return this.#request<ProjectRegistry>({ type: DKT_MSG.GET_SNAPSHOT })
	}

	subscribe(listener: PatchListener): () => void {
		this.#listeners.add(listener)
		return () => {
			this.#listeners.delete(listener)
		}
	}

	dispatch(command: Command): Promise<DispatchResult> {
		return this.#request<DispatchResult>({ type: DKT_MSG.DISPATCH_COMMAND, command })
	}

	replaceSnapshot(snapshot: ProjectRegistry): Promise<void> {
		return this.#request<ProjectRegistry>({
			type: DKT_MSG.REPLACE_SNAPSHOT,
			snapshot: structuredClone(snapshot),
		}).then(() => undefined)
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

	#request<Result>(message: MiniCutDktTransportMessage): Promise<Result> {
		const requestId = nanoid(8)
		return new Promise((resolve, reject) => {
			if (this.#isDestroyed) {
				reject(new Error('DKT SharedWorker authority client is destroyed'))
				return
			}

			if (this.#loadFailed) {
				reject(new Error('DKT SharedWorker failed to load'))
				return
			}

			const timeoutId = setTimeout(() => {
				this.#pending.delete(requestId)
				const error = new Error(`DKT SharedWorker request timed out: ${message.type}`)
				this.#onError?.(error)
				console.warn('[minicut:dkt-worker] request timed out', { message: message.type, requestId })
				reject(error)
			}, this.#requestTimeoutMs)

			this.#pending.set(requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
			})
			this.#worker.port.postMessage({ ...message, requestId })
		})
	}

	#failAllPending(error: Error): void {
		this.#loadFailed = true
		this.#onError?.(error)
		console.warn('[minicut:dkt-worker] unavailable', error)
		for (const [requestId, pending] of this.#pending) {
			clearTimeout(pending.timeoutId)
			pending.reject(new Error(`${error.message}: ${requestId}`))
		}
		this.#pending.clear()
	}

	#resolvePending(requestId: string | undefined, value: unknown): void {
		if (!requestId) {
			return
		}
		const pending = this.#pending.get(requestId)
		if (!pending) {
			return
		}
		this.#pending.delete(requestId)
		clearTimeout(pending.timeoutId)
		pending.resolve(value)
	}

	#rejectPending(requestId: string | undefined, error: Error): void {
		if (!requestId) {
			this.#onError?.(error)
			return
		}
		const pending = this.#pending.get(requestId)
		if (!pending) {
			this.#onError?.(error)
			return
		}
		this.#pending.delete(requestId)
		clearTimeout(pending.timeoutId)
		pending.reject(error)
	}

	#handleMessage(message: MiniCutDktTransportMessage): void {
		switch (message.type) {
			case DKT_MSG.SYNC_HANDLE:
				this.#onSyncMessage?.(message)
				return
			case DKT_MSG.PATCHES:
				for (const listener of this.#listeners) {
					listener(message.envelope as PatchEnvelope)
				}
				return
			case DKT_MSG.SNAPSHOT:
				this.#resolvePending(message.requestId, message.snapshot)
				return
			case DKT_MSG.DISPATCH_RESULT:
				this.#resolvePending(message.requestId, message.result)
				return
			case DKT_MSG.RUNTIME_READY:
				if (message.requestId) {
					this.#resolvePending(message.requestId, true)
				}
				return
			case DKT_MSG.RUNTIME_ERROR:
				this.#rejectPending(message.requestId, new Error(String(message.message)))
				return
		}
	}

	destroy(): void {
		if (this.#isDestroyed) {
			return
		}

		this.#isDestroyed = true
		this.#listeners.clear()
		for (const [requestId, pending] of this.#pending) {
			clearTimeout(pending.timeoutId)
			pending.reject(new Error(`DKT SharedWorker request cancelled: ${requestId}`))
		}
		this.#pending.clear()
		this.#worker.port.postMessage({ type: DKT_MSG.CLOSE_SESSION } satisfies MiniCutDktTransportMessage)
		this.#worker.port.onmessage = null
		this.#worker.port.close()
	}
}

export const canUseDktSharedWorkerAuthority = (): boolean =>
	typeof SharedWorker !== 'undefined'
