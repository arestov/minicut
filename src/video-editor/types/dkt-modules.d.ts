declare module 'dkt/model.js' {
	export const model: <Definition>(definition: Definition) => unknown
}

declare module 'dkt/appRoot.js' {
	export const appRoot: <Definition>(definition: Definition, init?: (target: unknown) => void) => unknown
}

declare module 'dkt/dcl/merge.js' {
	export const merge: <Definition>(definition: Definition) => Definition
}

declare module 'dkt/runtime/app/prepare.js' {
	export const prepare: (options?: unknown) => unknown
}

declare module 'dkt/dom-sync/transport.js' {
	export interface DomSyncTransportLike<Message = unknown> {
		send(message: Message, transferList?: Transferable[]): void
		listen(listener: (message: Message) => void): () => void
		destroy(): void
	}

	export interface DomSyncTransportViewLike<Message = unknown> extends DomSyncTransportLike<Message> {}

	export interface DomSyncPortLike<Message = unknown> {
		postMessage(message: Message, transferList?: Transferable[]): void
		addEventListener?(type: 'message', listener: (event: DomSyncTransportPayloadLike<Message>) => void): void
		removeEventListener?(type: 'message', listener: (event: DomSyncTransportPayloadLike<Message>) => void): void
		on?(type: 'message', listener: (event: DomSyncTransportPayloadLike<Message>) => void): void
		off?(type: 'message', listener: (event: DomSyncTransportPayloadLike<Message>) => void): void
		removeListener?(type: 'message', listener: (event: DomSyncTransportPayloadLike<Message>) => void): void
		start?(): void
		close?(): void
	}

	export type DomSyncTransportPayloadLike<Message = unknown> = MessageEvent<Message> | Message
}

declare module 'dkt-all/libs/provoda/bwlev/SessionRoot.js' {
	export const SessionRoot: unknown
}

declare module 'dkt-all/libs/provoda/provoda/BrowseMap.js' {
	export const hookSessionRoot: (appModel: unknown, startPage: unknown, options?: unknown) => Promise<unknown>
}

declare module 'dkt-all/libs/provoda/_internal/_listRels.js' {
	export const _listRels: (model: unknown) => Iterable<string>
	export const _getCurrentRel: (model: unknown, relName: string) => unknown
}

declare module 'dkt-all/libs/provoda/utils/getModelById.js' {
	export const getModelById: (root: unknown, nodeId: string) => unknown
}
