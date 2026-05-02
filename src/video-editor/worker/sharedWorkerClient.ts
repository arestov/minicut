import { nanoid } from 'nanoid'
import { MSG, type Command, type DispatchResult, type HistoryState, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import type { EditorAuthorityClient, PatchListener } from './authorityClient'

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
	timeoutId: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 5000
const DEFAULT_SHARED_WORKER_NAME = 'minicut-video-editor-authority'
const DEFAULT_SHARED_WORKER_URL = new URL('./sharedWorker.ts', import.meta.url)

export interface SharedWorkerAuthorityClientOptions {
	workerUrl?: string | URL
	name?: string
	requestTimeoutMs?: number
}

export class SharedWorkerAuthorityClient implements EditorAuthorityClient {
	#worker: SharedWorker
	#requestTimeoutMs: number

	#listeners = new Set<PatchListener>()
	#pending = new Map<string, PendingRequest>()
	#isDestroyed = false

	constructor(options: SharedWorkerAuthorityClientOptions = {}) {
		this.#requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
		this.#worker = new SharedWorker(options.workerUrl ?? DEFAULT_SHARED_WORKER_URL, {
			type: 'module',
			name: options.name ?? DEFAULT_SHARED_WORKER_NAME,
		})
		this.#worker.port.onmessage = (event: MessageEvent<WireMessage>) => {
			this.#handleMessage(event.data)
		}
		this.#worker.port.start()
	}

	getSnapshot(): Promise<ProjectRegistry> {
		return this.#request<ProjectRegistry>({ m: MSG.SNAPSHOT_REQUEST })
	}

	getHistoryState(): Promise<HistoryState> {
		return this.#request<HistoryState>({ m: MSG.HISTORY_STATE_REQUEST })
	}

	subscribe(listener: PatchListener): () => void {
		this.#listeners.add(listener)
		return () => {
			this.#listeners.delete(listener)
		}
	}

	dispatch(command: Command): Promise<DispatchResult> {
		return this.#request<DispatchResult>({ m: MSG.COMMAND, p: command })
	}

	undo(): Promise<PatchEnvelope | null> {
		return this.#request<PatchEnvelope | null>({ m: MSG.UNDO })
	}

	redo(): Promise<PatchEnvelope | null> {
		return this.#request<PatchEnvelope | null>({ m: MSG.REDO })
	}

	replaceSnapshot(snapshot: ProjectRegistry): Promise<void> {
		return this.#request<boolean>({
			m: MSG.REGISTRY_RESTORE_REQUEST,
			p: structuredClone(snapshot),
		}).then(() => undefined)
	}

	#request<Result>(message: WireMessage): Promise<Result> {
		const requestId = nanoid(8)
		return new Promise((resolve, reject) => {
			if (this.#isDestroyed) {
				reject(new Error('SharedWorker authority client is destroyed'))
				return
			}

			const timeoutId = setTimeout(() => {
				this.#pending.delete(requestId)
				reject(new Error(`SharedWorker request timed out: ${message.m}`))
			}, this.#requestTimeoutMs)

			this.#pending.set(requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
			})
			this.#worker.port.postMessage({ ...message, requestId })
		})
	}

	#handleMessage(message: WireMessage): void {
		if (message.m === MSG.PATCHES) {
			for (const listener of this.#listeners) {
				listener(message.p as PatchEnvelope)
			}
			return
		}

		if (!message.requestId) {
			return
		}

		const pending = this.#pending.get(message.requestId)
		if (!pending) {
			return
		}

		this.#pending.delete(message.requestId)
		clearTimeout(pending.timeoutId)
		if (message.m === MSG.ERROR) {
			pending.reject(new Error(String(message.p)))
			return
		}

		pending.resolve(message.p)
	}

	destroy(): void {
		if (this.#isDestroyed) {
			return
		}

		this.#isDestroyed = true
		this.#listeners.clear()
		for (const [requestId, pending] of this.#pending) {
			clearTimeout(pending.timeoutId)
			pending.reject(new Error(`SharedWorker request cancelled: ${requestId}`))
		}
		this.#pending.clear()
		this.#worker.port.postMessage({ m: MSG.DISCONNECT })
		this.#worker.port.onmessage = null
		this.#worker.port.close()
	}
}

export const canUseSharedWorkerAuthority = (): boolean =>
	typeof SharedWorker !== 'undefined'