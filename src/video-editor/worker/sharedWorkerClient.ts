import { nanoid } from 'nanoid'
import { MSG, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import type { EditorAuthorityClient, PatchListener } from './authorityClient'

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
	timeoutId: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 5000

export class SharedWorkerAuthorityClient implements EditorAuthorityClient {
	#worker = new SharedWorker(new URL('./sharedWorker.ts', import.meta.url), {
		type: 'module',
		name: 'minicut-video-editor-authority',
	})

	#listeners = new Set<PatchListener>()
	#pending = new Map<string, PendingRequest>()
	#isDestroyed = false

	constructor() {
		this.#worker.port.onmessage = (event: MessageEvent<WireMessage>) => {
			this.#handleMessage(event.data)
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
			}, REQUEST_TIMEOUT_MS)

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