/**
 * P2P wire protocol and resource transfer types.
 * All entity/registry/command/patch/attrs types have been migrated to:
 *   - render/registryTypes.ts  (render pipeline entity/registry types)
 *   - models/<model>/types.ts        (per-model attribute types)
 */

export type ResourceKind = "video" | "audio" | "image" | "text";
export type ResourceSourceKind = "local" | "p2p";
export type ResourceDataStatus = "missing" | "partial" | "ready";
export type ResourceChunkStatus = "missing" | "loading" | "ready";
export type ResourceByteRange = [number, number];

export interface ResourceSource {
	kind: ResourceSourceKind;
	ownerPeerId?: string;
}

export interface ResourceChunkMeta {
	index: number;
	start: number;
	end: number;
	size: number;
	status: ResourceChunkStatus;
}

export interface ResourceDataState {
	status: ResourceDataStatus;
	chunkSize: number;
	chunks: Record<number, ResourceChunkMeta>;
	ranges: {
		loaded: ResourceByteRange[];
		requested: ResourceByteRange[];
	};
	loadedBytes: number;
}

export interface ResourceDerived {
	progress: number;
	isPlayable: boolean;
	loadedBytes: number;
	loadedRanges: ResourceByteRange[];
	requestedRanges: ResourceByteRange[];
}

export interface Peer {
	id: string;
	resources: string[];
}

export const MSG = {
	SNAPSHOT_REQUEST: -1,
	SNAPSHOT: -2,
	COMMAND: -3,
	PATCHES: -4,
	ERROR: -5,
	DISPATCH_RESULT: -6,
	DISCONNECT: -7,
	REGISTRY_RESTORE_REQUEST: -12,
	REGISTRY_RESTORE_ACK: -13,
} as const;

export const AUTHORITY_PROTOCOL_VERSION = 1 as const;
export const RESOURCE_TRANSFER_PROTOCOL_VERSION = 1 as const;

export interface WireProtocolMeta {
	protocolVersion?: number;
	schemaVersion?: number;
	capabilities?: string[];
}

export interface WireMessage<Payload = unknown> {
	m: (typeof MSG)[keyof typeof MSG];
	requestId?: string;
	p?: Payload;
	meta?: WireProtocolMeta;
}
