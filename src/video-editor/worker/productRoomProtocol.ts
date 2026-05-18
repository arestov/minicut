import type { WorkspaceOpenState } from "../dkt/runtime/workspaceOpenState";

export const PRODUCT_ROOM_MSG = {
	TAB_HELLO: 0,
	WORKSPACE_OPEN_STATE: 1,
	ATTACH_WEBRTC: 2,
	DETACH_WEBRTC: 3,
	WEBRTC_OWNER_HEARTBEAT: 4,
	WEBRTC_OWNER_STATUS: 5,
	TRANSPORT_INBOUND_MESSAGE: 6,
	TRANSPORT_OUTBOUND_MESSAGE: 7,
} as const;

export const WEBRTC_OWNER_STATUS = {
	ATTACHED: 0,
	REJECTED_ROOM_MISMATCH: 1,
	CLOSED: 2,
	FAILED: 3,
} as const;

export type ProductRoomMessageType =
	(typeof PRODUCT_ROOM_MSG)[keyof typeof PRODUCT_ROOM_MSG];

export type WebRtcOwnerStatus =
	(typeof WEBRTC_OWNER_STATUS)[keyof typeof WEBRTC_OWNER_STATUS];

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
	transportOwnerToken: string;
};

export type ProductRoomDetachWebRtc = {
	type: typeof PRODUCT_ROOM_MSG.DETACH_WEBRTC;
	roomId: string;
	transportOwnerToken: string;
};

export type ProductRoomWebRtcOwnerHeartbeat = {
	type: typeof PRODUCT_ROOM_MSG.WEBRTC_OWNER_HEARTBEAT;
	tabId: string;
	roomId: string;
	transportOwnerToken: string;
};

export type ProductRoomWebRtcOwnerStatus = {
	type: typeof PRODUCT_ROOM_MSG.WEBRTC_OWNER_STATUS;
	tabId: string;
	roomId: string;
	transportOwnerToken: string;
	status: WebRtcOwnerStatus;
	error?: string;
};

export type ProductRoomTransportInboundMessage = {
	type: typeof PRODUCT_ROOM_MSG.TRANSPORT_INBOUND_MESSAGE;
	roomId: string;
	transportOwnerToken: string;
	payload: unknown;
};

export type ProductRoomTransportOutboundMessage = {
	type: typeof PRODUCT_ROOM_MSG.TRANSPORT_OUTBOUND_MESSAGE;
	roomId: string;
	payload: unknown;
};

export type ProductRoomProtocolMessage =
	| ProductRoomTabHello
	| ProductRoomWorkspaceOpenStateMessage
	| ProductRoomAttachWebRtc
	| ProductRoomDetachWebRtc
	| ProductRoomWebRtcOwnerHeartbeat
	| ProductRoomWebRtcOwnerStatus
	| ProductRoomTransportInboundMessage
	| ProductRoomTransportOutboundMessage;
