import type { WorkspaceOpenState } from "../dkt/runtime/workspaceOpenState";

export const PRODUCT_ROOM_MSG = {
	TAB_HELLO: 0,
	WORKSPACE_OPEN_STATE: 1,
	ATTACH_WEBRTC: 2,
	DETACH_WEBRTC: 3,
	WEBRTC_STATUS: 4,
	CRDT_SEND: 5,
	CRDT_RECEIVE: 6,
	MEDIA_SEND: 7,
	MEDIA_RECEIVE: 8,
	TRANSPORT_ERROR: 9,
} as const;

export const WEBRTC_OWNER_STATUS = {
	ATTACHED: 0,
	REJECTED_ROOM_MISMATCH: 1,
	CLOSED: 2,
	FAILED: 3,
} as const;

export const PRODUCT_ROOM_TRANSPORT_ERROR = {
	ROOM_MISMATCH: "room_mismatch",
	STALE_GENERATION: "stale_generation",
	NO_TRANSPORT_OWNER: "no_transport_owner",
	TAB_NOT_OWNER: "tab_not_owner",
} as const;

export type ProductRoomMessageType =
	(typeof PRODUCT_ROOM_MSG)[keyof typeof PRODUCT_ROOM_MSG];

export type WebRtcOwnerStatus =
	(typeof WEBRTC_OWNER_STATUS)[keyof typeof WEBRTC_OWNER_STATUS];

export type ProductRoomTransportErrorCode =
	(typeof PRODUCT_ROOM_TRANSPORT_ERROR)[keyof typeof PRODUCT_ROOM_TRANSPORT_ERROR];

export type ProductRoomTabHello = {
	type: typeof PRODUCT_ROOM_MSG.TAB_HELLO;
	tabId: string;
	roomId: string;
	canHostWebRtc: boolean;
};

export type ProductRoomWorkspaceOpenStateMessage = {
	type: typeof PRODUCT_ROOM_MSG.WORKSPACE_OPEN_STATE;
	state: WorkspaceOpenState;
};

export type ProductRoomAttachWebRtc = {
	type: typeof PRODUCT_ROOM_MSG.ATTACH_WEBRTC;
	roomId: string;
	transportGeneration: number;
	config?: unknown;
};

export type ProductRoomDetachWebRtc = {
	type: typeof PRODUCT_ROOM_MSG.DETACH_WEBRTC;
	roomId: string;
	transportGeneration: number;
};

export type ProductRoomWebRtcStatus = {
	type: typeof PRODUCT_ROOM_MSG.WEBRTC_STATUS;
	tabId: string;
	roomId: string;
	transportGeneration: number;
	status: WebRtcOwnerStatus;
	error?: string;
};

export type ProductRoomCrdtSend = {
	type: typeof PRODUCT_ROOM_MSG.CRDT_SEND;
	roomId: string;
	transportGeneration: number;
	packet: unknown;
	targetPeerId?: string;
};

export type ProductRoomCrdtReceive = {
	type: typeof PRODUCT_ROOM_MSG.CRDT_RECEIVE;
	roomId: string;
	transportGeneration: number;
	packet: unknown;
	sourcePeerId?: string;
};

export type ProductRoomMediaSend = {
	type: typeof PRODUCT_ROOM_MSG.MEDIA_SEND;
	roomId: string;
	transportGeneration: number;
	envelope: unknown;
	targetPeerId?: string;
};

export type ProductRoomMediaReceive = {
	type: typeof PRODUCT_ROOM_MSG.MEDIA_RECEIVE;
	roomId: string;
	transportGeneration: number;
	envelope: unknown;
	sourcePeerId?: string;
};

export type ProductRoomTransportError = {
	type: typeof PRODUCT_ROOM_MSG.TRANSPORT_ERROR;
	roomId: string;
	transportGeneration?: number;
	errorCode: ProductRoomTransportErrorCode;
	details?: unknown;
};

export type ProductRoomTransportMessageResult =
	| { ok: true }
	| { ok: false; errorCode: ProductRoomTransportErrorCode };

export type ProductRoomCrdtSendResult =
	| { ok: true; generation: number }
	| { ok: false; errorCode: ProductRoomTransportErrorCode };

export type ProductRoomCrdtPacketHandler = (packet: {
	payload: unknown;
	sourcePeerId?: string;
	transportGeneration: number;
	roomId: string;
}) => void;

export type ProductRoomMediaPacketHandler = (packet: {
	envelope: unknown;
	sourcePeerId?: string;
	transportGeneration: number;
	roomId: string;
}) => void;

export type ProductRoomOwnerMessage = {
	tabId: string;
	roomId: string;
	transportGeneration: number;
};

export type ProductRoomProtocolMessage =
	| ProductRoomTabHello
	| ProductRoomWorkspaceOpenStateMessage
	| ProductRoomAttachWebRtc
	| ProductRoomDetachWebRtc
	| ProductRoomWebRtcStatus
	| ProductRoomCrdtSend
	| ProductRoomCrdtReceive
	| ProductRoomMediaSend
	| ProductRoomMediaReceive
	| ProductRoomTransportError;
