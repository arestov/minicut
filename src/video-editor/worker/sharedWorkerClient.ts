import { nanoid } from 'nanoid'
import { MSG, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import type { EditorAuthorityClient, PatchListener } from './authorityClient'

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
}

export class SharedWorkerAuthorityClient implements EditorAuthorityClient {
	#worker = new SharedWorker(new URL('./sharedWorker.ts', import.meta.url), {
		type: 'module',
		name: 'minicut-video-editor-authority',
	})

	#listeners = new Set<PatchListener>()
	#pending = new Map<string, PendingRequest>()

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
			this.#pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject })
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
		if (message.m === MSG.ERROR) {
			pending.reject(new Error(String(message.p)))
			return
		}

		pending.resolve(message.p)
	}
}

export const canUseSharedWorkerAuthority = (): boolean =>
	typeof SharedWorker !== 'undefined'