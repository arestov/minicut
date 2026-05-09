export const AUTH_EXT_CHANNEL = {
	EXPORT_DOWNLOAD: 1,
} as const

export const AUTH_EXT_EVENT = {
	EXPORT_READY: 1,
} as const

export type AuthorityExtensionChannelId =
	(typeof AUTH_EXT_CHANNEL)[keyof typeof AUTH_EXT_CHANNEL]

export type AuthorityExtensionEventId =
	(typeof AUTH_EXT_EVENT)[keyof typeof AUTH_EXT_EVENT]

export interface AuthorityExtensionEnvelope {
	channel: AuthorityExtensionChannelId
	event: AuthorityExtensionEventId
	payload: unknown
}

type AuthorityExtensionListener = (event: AuthorityExtensionEnvelope) => void

export interface AuthorityExtensionBus {
	publish(event: AuthorityExtensionEnvelope): void
	subscribe(channel: AuthorityExtensionChannelId, listener: AuthorityExtensionListener): () => void
	clear(): void
}

export const createAuthorityExtensionBus = (): AuthorityExtensionBus => {
	const listeners = new Map<AuthorityExtensionChannelId, Set<AuthorityExtensionListener>>()

	const publish = (event: AuthorityExtensionEnvelope): void => {
		const channelListeners = listeners.get(event.channel)
		if (!channelListeners || channelListeners.size === 0) {
			return
		}
		for (const listener of channelListeners) {
			listener(event)
		}
	}

	const subscribe = (
		channel: AuthorityExtensionChannelId,
		listener: AuthorityExtensionListener,
	): (() => void) => {
		const channelListeners = listeners.get(channel) ?? new Set<AuthorityExtensionListener>()
		channelListeners.add(listener)
		listeners.set(channel, channelListeners)

		return () => {
			const current = listeners.get(channel)
			if (!current) {
				return
			}
			current.delete(listener)
			if (current.size === 0) {
				listeners.delete(channel)
			}
		}
	}

	const clear = (): void => {
		listeners.clear()
	}

	return {
		publish,
		subscribe,
		clear,
	}
}