import { nanoid } from 'nanoid'
import { MSG, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import type { EditorAuthorityClient, PatchListener } from './authorityClient'

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
	timeoutId: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 5000
const DEFAULT_SHARED_WORKER_NAME = 'minicut-video-editor-authority'

export interface SharedWorkerAuthorityClientOptions {
	workerUrl?: string | URL
	name?: string
	requestTimeoutMs?: number
	onError?: (error: Error) => void
}

export class SharedWorkerAuthorityClient implements EditorAuthorityClient {
	#worker: SharedWorker
	#requestTimeoutMs: number
	#onError?: (error: Error) => void

	#listeners = new Set<PatchListener>()
	#pending = new Map<string, PendingRequest>()
	#isDestroyed = false
	#loadFailed = false

	constructor(options: SharedWorkerAuthorityClientOptions = {}) {
		this.#requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
		this.#onError = options.onError
		// Keep this construction pattern intentionally explicit for Vite.
		//
		// Why the code is verbose and duplicated:
		// - Vite only transforms worker URLs when it can statically see
		//   `new SharedWorker(new URL('...', import.meta.url), { ...literal... })`.
		// - Earlier compact versions (coalescing expressions / prebuilt options objects)
		//   either failed Vite parsing or allowed `.ts` worker paths to leak to runtime.
		// - Those leaked `.ts` URLs are served with a non-JS MIME on static hosting,
		//   so the browser refuses to initialize the worker.
		//
		// We therefore keep two explicit branches:
		// 1) custom URL provided externally
		// 2) Vite-static default URL based on import.meta.url
		this.#worker = options.workerUrl
			? new SharedWorker(options.workerUrl, {
				type: 'module',
				name: options.name ?? DEFAULT_SHARED_WORKER_NAME,
			})
			: new SharedWorker(new URL('./sharedWorker.ts', import.meta.url), {
				type: 'module',
				name: options.name ?? DEFAULT_SHARED_WORKER_NAME,
			})
		this.#worker.onerror = (e) => {
			console.error(e.message, e)
			this.#failAllPending(new Error('SharedWorker failed to load'))
		}
		this.#worker.port.onmessage = (event: MessageEvent<WireMessage>) => {
			this.#handleMessage(event.data)
		}
		this.#worker.port.onmessageerror = () => {
			this.#failAllPending(new Error('SharedWorker port message error'))
		}
		this.#worker.port.start()
	}

	getSnapshot(): Promise<ProjectRegistry> {
		return this.#request<ProjectRegistry>({ m: MSG.SNAPSHOT_REQUEST })
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

			if (this.#loadFailed) {
				reject(new Error('SharedWorker failed to load'))
				return
			}

			const timeoutId = setTimeout(() => {
				this.#pending.delete(requestId)
				const error = new Error(`SharedWorker request timed out: ${message.m}`)
				this.#onError?.(error)
				console.warn('[minicut:worker] SharedWorker request timed out', {
					message: message.m,
					requestId,
				})
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
		console.warn('[minicut:worker] SharedWorker unavailable', error)
		for (const [requestId, pending] of this.#pending) {
			clearTimeout(pending.timeoutId)
			pending.reject(error)
		}
		this.#pending.clear()
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
